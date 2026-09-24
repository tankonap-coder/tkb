import { Client, GatewayIntentBits, Partials } from 'discord.js';
import { GoogleGenAI } from '@google/genai';
import cron from 'node-cron';
import dotenv from 'dotenv';
import fs from 'fs';

dotenv.config();

const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const CHANNEL_ID = process.env.CHANNEL_ID; // ID kênh DM của bạn
const GIO_SANG = process.env.GIO_SANG || "06:00";
const GIO_TOI = process.env.GIO_TOI || "19:00";

const DATA_FILE = './tkb_data.json';
const TIMEZONE = "Asia/Ho_Chi_Minh";

const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

// Khởi tạo Client hỗ trợ đọc Direct Messages (DM)
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
    "Saturday": "Thứ 7",
    "Sunday": "Chủ Nhật"
};

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

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
        "Saturday": "...",
        "Sunday": "Nghỉ học"
    }
    Lưu ý: Chỉ liệt kê môn học theo thứ tự tiết 1, 2, 3, 4, 5 của từng thứ (từ Monday đến Saturday). Nếu không có lịch ghi "Nghỉ học".
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

// Lắng nghe sự kiện khi Bot khởi động
client.once('clientReady', () => {
    console.log(`Bot đã kết nối thành công: ${client.user.tag}`);
    setupCronJobs();
});

// Lắng nghe sự kiện có tin nhắn mới (Cả Server lẫn DM)
client.on('messageCreate', async (message) => {
    if (message.author.bot) return;

    if (message.attachments.size > 0) {
        const attachment = message.attachments.first();
        const isImage = attachment.contentType?.startsWith('image/');

        if (isImage) {
            await message.channel.send("🤖 **Gemini AI** đang phân tích ảnh TKB, vui lòng chờ chút...");

            try {
                const parsedTkb = await analyzeTkbWithAI(attachment.url);
                saveTkb(parsedTkb);
                await message.channel.send("✅ **Đã đọc và lưu Thời khóa biểu thành công!**");
            } catch (error) {
                console.error(error);
                await message.channel.send(`❌ Lỗi khi đọc ảnh TKB: ${error.message}`);
            }
        }
    }
});

function setupCronJobs() {
    const [gioSang, phutSang] = GIO_SANG.split(':');
    const [gioToi, phutToi] = GIO_TOI.split(':');

    // Cron job 06:00 sáng
    cron.schedule(`${phutSang} ${gioSang} * * *`, async () => {
        const now = new Date(new Date().toLocaleString("en-US", { timeZone: TIMEZONE }));
        const dayKey = DAYS[now.getDay()];
        const thuToday = TEN_THU_VI[dayKey] || dayKey;
        
        const tkbData = loadTkb();
        const tkbContent = tkbData[dayKey] || "Chưa có dữ liệu TKB.";

        try {
            const channel = await client.channels.fetch(CHANNEL_ID);
            if (channel) {
                await channel.send(`☀️ **THỜI KHÓA BIỂU HÔM NAY (${thuToday.toUpperCase()})**\n\n${tkbContent}`);
                console.log(`[${GIO_SANG} VN] Đã gửi TKB hôm nay (${thuToday})`);
            }
        } catch (err) {
            console.error("Lỗi khi gửi tin nhắn DM:", err.message);
        }
    }, { timezone: TIMEZONE });

    // Cron job 19:00 tối
    cron.schedule(`${phutToi} ${gioToi} * * *`, async () => {
        const now = new Date(new Date().toLocaleString("en-US", { timeZone: TIMEZONE }));
        const tomorrow = new Date(now);
        tomorrow.setDate(now.getDate() + 1);

        const tomorrowKey = DAYS[tomorrow.getDay()];
        const thuTomorrow = TEN_THU_VI[tomorrowKey] || tomorrowKey;

        const tkbData = loadTkb();
        const tkbContent = tkbData[tomorrowKey] || "Chưa có dữ liệu TKB.";

        try {
            const channel = await client.channels.fetch(CHANNEL_ID);
            if (channel) {
                await channel.send(`🌙 **THỜI KHÓA BIỂU NGÀY MAI (${thuTomorrow.toUpperCase()})**\n\n${tkbContent}`);
                console.log(`[${GIO_TOI} VN] Đã gửi TKB ngày mai (${thuTomorrow})`);
            }
        } catch (err) {
            console.error("Lỗi khi gửi tin nhắn DM:", err.message);
        }
    }, { timezone: TIMEZONE });

    console.log(`Đã đặt lịch gửi TKB tự động (Múi giờ VN): Sáng ${GIO_SANG} & Tối ${GIO_TOI}`);
}

client.login(DISCORD_TOKEN);