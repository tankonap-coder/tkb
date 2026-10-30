import fs from 'fs';
import http from 'http';
import https from 'https';
import { Client, GatewayIntentBits, Partials } from 'discord.js';
import { GoogleGenAI } from '@google/genai';
import cron from 'node-cron';

try {
    if (process.env.NODE_ENV !== 'production') {
        const dotenv = await import('dotenv');
        dotenv.config();
    }
} catch (e) {}

// ==========================================
// 1. CƠ CHẾ CHỐNG NGỦ (KEEP-ALIVE CHO RENDER)
// ==========================================
const PORT = process.env.PORT || 8081;

http.createServer((req, res) => {
    if (req.url === '/health' || req.url === '/') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'alive', uptime: process.uptime() }));
    } else {
        res.writeHead(404);
        res.end('Not Found');
    }
}).listen(PORT, () => {
    console.log(`[HTTP] Server keep-alive đang chạy trên cổng ${PORT}`);
});

const EXTERNAL_URL = process.env.RENDER_EXTERNAL_URL;
if (EXTERNAL_URL) {
    console.log(`[+] Đã nhận diện URL Public của Render: ${EXTERNAL_URL}`);
} else {
    console.log(`[-] Lưu ý: Không tìm thấy RENDER_EXTERNAL_URL (chỉ chạy nội bộ).`);
}

// Tự động ping mỗi 3 phút chống ngủ
setInterval(() => {
    http.get(`http://127.0.0.1:${PORT}/health`, () => {}).on('error', () => {});
    if (EXTERNAL_URL) {
        https.get(`${EXTERNAL_URL}/health`, () => {}).on('error', () => {});
    }
}, 180000);


// ==========================================
// 2. CẤU HÌNH BOT DISCORD & GEMINI
// ==========================================
const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const CHANNEL_ID = process.env.CHANNEL_ID; 
const GIO_SANG = process.env.GIO_SANG || "06:00";
const GIO_TOI = process.env.GIO_TOI || "19:00";

// Cấu hình GitHub sync tkb_data.json
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_OWNER = process.env.GITHUB_OWNER || "tankonap-coder";
const GITHUB_REPO = process.env.GITHUB_REPO || "tkb";
const GITHUB_BRANCH = process.env.GITHUB_BRANCH || "main";

const DATA_FILE = './tkb_data.json';
const TIMEZONE = "Asia/Ho_Chi_Minh";

const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.DirectMessages,
        GatewayIntentBits.MessageContent
    ],
    partials: [Partials.Channel, Partials.Message]
});

const TEN_THU_VI = {
    "Monday": "Thứ 2",
    "Tuesday": "Thứ 3",
    "Wednesday": "Thứ 4",
    "Thursday": "Thứ 5",
    "Friday": "Thứ 6",
    "Saturday": "Thứ 7"
};

const USER_TAG = "<@1188753053898260531>";

function saveTkb(data) {
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 4), 'utf-8');
}

function loadTkb() {
    if (fs.existsSync(DATA_FILE)) {
        const rawData = fs.readFileSync(DATA_FILE, 'utf-8');
        return JSON.parse(rawData);
    }
    return {};
}

// Đồng bộ TKB lên GitHub
async function uploadTkbToGitHub(jsonData) {
    if (!GITHUB_TOKEN) {
        console.log("⚠️ Chưa cấu hình GITHUB_TOKEN trong .env, bỏ qua đồng bộ Git.");
        return;
    }

    const path = 'tkb_data.json';
    const url = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${path}`;
    const contentEncoded = Buffer.from(JSON.stringify(jsonData, null, 4)).toString('base64');

    try {
        let sha = null;
        const getResponse = await fetch(url, {
            headers: {
                'Authorization': `Bearer ${GITHUB_TOKEN}`,
                'User-Agent': 'Discord-TKB-Bot',
                'Accept': 'vnd.github+json'
            }
        });

        if (getResponse.ok) {
            const fileData = await getResponse.json();
            sha = fileData.sha;
        }

        const bodyData = {
            message: "Update tkb_data.json via Discord Bot",
            content: contentEncoded,
            branch: GITHUB_BRANCH
        };
        if (sha) bodyData.sha = sha;

        const putResponse = await fetch(url, {
            method: 'PUT',
            headers: {
                'Authorization': `Bearer ${GITHUB_TOKEN}`,
                'User-Agent': 'Discord-TKB-Bot',
                'Accept': 'vnd.github+json',
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(bodyData)
        });

        if (putResponse.ok) {
            console.log("☁️ Đã đồng bộ và đẩy `tkb_data.json` lên GitHub thành công!");
        } else {
            const errRes = await putResponse.text();
            console.error("❌ Lỗi khi đẩy file lên GitHub:", errRes);
        }
    } catch (error) {
        console.error("❌ Lỗi kết nối GitHub API:", error.message);
    }
}

async function analyzeTkbWithAI(imageUrl) {
    const response = await fetch(imageUrl);
    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    const prompt = `
    Hãy đọc hình ảnh Thời khóa biểu này và trả về dữ liệu dưới dạng JSON thuần túy (không dùng markdown codeblock, không thêm bất kỳ văn bản nào khác).
    Định dạng JSON cần trả về chính xác như sau:
    {
        "Monday": "Tiết 1: Môn A\\nTiết 2: Môn B\\n...",
        "Tuesday": "Tiết 1: Môn C\\n...",
        "Wednesday": "...",
        "Thursday": "...",
        "Friday": "...",
        "Saturday": "..."
    }
    Lưu ý: Chỉ liệt kê môn học theo thứ tự tiết 1, 2, 3, 4, 5 của từng thứ từ Monday đến Saturday.
    `;

    const aiResponse = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: [
            prompt,
            {
                inlineData: {
                    data: buffer.toString('base64'),
                    mimeType: 'image/png'
                }
            }
        ]
    });

    const cleanText = aiResponse.text.replace(/```json/g, '').replace(/```/g, '').trim();
    return JSON.parse(cleanText);
}

function getVietnamDate(offsetDays = 0) {
    const now = new Date();
    if (offsetDays !== 0) {
        now.setDate(now.getDate() + offsetDays);
    }
    const weekdayOption = { timeZone: TIMEZONE, weekday: 'long' };
    const dayName = new Intl.DateTimeFormat('en-US', weekdayOption).format(now);
    
    return { dateObj: now, dayName };
}

client.once('ready', () => {
    console.log(`Bot Discord đã kết nối thành công: ${client.user.tag}`);
    setupCronJobs();
});

// Xử lý tin nhắn (CHỈ NHẬN TRONG TIN NHẮN RIÊNG - DM)
client.on('messageCreate', async (message) => {
    if (message.author.bot) return;

    // Chặn tất cả tin nhắn xuất phát từ server chung, chỉ cho phép DM
    if (message.guild) return;

    // 1. NẾU GỬI ẢNH TRONG DM: Phân tích bằng AI và lưu trữ
    if (message.attachments.size > 0) {
        const attachment = message.attachments.first();
        const isImage = attachment.contentType?.startsWith('image/');

        if (isImage) {
            await message.channel.send("🤖 **Gemini AI** đang phân tích ảnh TKB, vui lòng chờ chút...");

            try {
                const parsedTkb = await analyzeTkbWithAI(attachment.url);
                saveTkb(parsedTkb);
                await uploadTkbToGitHub(parsedTkb);
                await message.channel.send("✅ **Đã đọc, lưu TKB và đồng bộ lên GitHub thành công!**");
            } catch (error) {
                console.error(error);
                await message.channel.send(`❌ Lỗi khi đọc ảnh TKB: ${error.message}`);
            }
        }
        return;
    }

    // 2. NẾU GỬI LỆNH TRONG DM (jt2, jt3, jt4, jt5, jt6, jt7)
    const content = message.content.trim().toLowerCase();
    const mapCmdToDay = {
        "jt2": { key: "Monday", name: "Thứ 2" },
        "jt3": { key: "Tuesday", name: "Thứ 3" },
        "jt4": { key: "Wednesday", name: "Thứ 4" },
        "jt5": { key: "Thursday", name: "Thứ 5" },
        "jt6": { key: "Friday", name: "Thứ 6" },
        "jt7": { key: "Saturday", name: "Thứ 7" }
    };

    if (mapCmdToDay[content]) {
        const { key, name } = mapCmdToDay[content];
        const tkbData = loadTkb();
        const tkbContent = tkbData[key] || "Chưa có dữ liệu TKB cho ngày này.";

        await message.reply(`📅 **THỜI KHÓA BIỂU ${name.toUpperCase()}**\n\n${tkbContent}`);
    }
});

function setupCronJobs() {
    const [gioSang, phutSang] = GIO_SANG.split(':');
    const [gioToi, phutToi] = GIO_TOI.split(':');

    // Cron sáng (06:00 - Bỏ qua Chủ Nhật)
    cron.schedule(`${phutSang} ${gioSang} * * *`, async () => {
        const { dayName } = getVietnamDate(0);
        if (dayName === "Sunday") return;

        const thuToday = TEN_THU_VI[dayName];
        if (!thuToday) return;

        const tkbData = loadTkb();
        const tkbContent = tkbData[dayName] || "Chưa có dữ liệu TKB.";

        try {
            const channel = await client.channels.fetch(CHANNEL_ID);
            if (channel) {
                await channel.send(`${USER_TAG} ☀️ **THỜI KHÓA BIỂU HÔM NAY (${thuToday.toUpperCase()})**\n\n${tkbContent}`);
            }
        } catch (err) {
            console.error("Lỗi khi gửi tin nhắn sáng:", err.message);
        }
    }, { timezone: TIMEZONE });

    // Cron tối (19:00 - Bỏ qua tối Thứ Bảy)
    cron.schedule(`${phutToi} ${gioToi} * * *`, async () => {
        const { dayName: currentDay } = getVietnamDate(0); 
        const { dayName: tomorrowDay } = getVietnamDate(1); 

        if (currentDay === "Saturday") return;

        const thuTomorrow = TEN_THU_VI[tomorrowDay];
        if (!thuTomorrow) return;

        const tkbData = loadTkb();
        const tkbContent = tkbData[tomorrowDay] || "Chưa có dữ liệu TKB.";

        try {
            const channel = await client.channels.fetch(CHANNEL_ID);
            if (channel) {
                await channel.send(`${USER_TAG} 🌙 **THỜI KHÓA BIỂU NGÀY MAI (${thuTomorrow.toUpperCase()})**\n\n${tkbContent}`);
            }
        } catch (err) {
            console.error("Lỗi khi gửi tin nhắn tối:", err.message);
        }
    }, { timezone: TIMEZONE });

    console.log(`Đã đặt lịch gửi TKB tự động (Có chặn Chủ Nhật & chỉ phản hồi lệnh qua DM).`);
}

client.login(DISCORD_TOKEN);
