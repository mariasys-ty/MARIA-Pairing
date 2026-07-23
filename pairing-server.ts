/**
 * MARIA PAIRING SERVER v4.4 - BAILEYS V7 OFFICIAL FLOW
 */

import express, { Request, Response, NextFunction } from 'express';
import pino from 'pino';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import {
  makeWASocket,
  useMultiFileAuthState,
  Browsers,
  WASocket,
  fetchLatestBaileysVersion
} from '@whiskeysockets/baileys';

import { createRequire } from 'module';
const require = createRequire(import.meta.url);
// Destructure the class properly to prevent "not a constructor" error
const { HttpsProxyAgent } = require('https-proxy-agent');

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = Number(process.env.PORT) || 7700;
const logger = pino({ level: 'silent' });

// Helper delay function
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// ============================================
// PROXY CONFIGURATION (Proxy6 - HTTP)
// ============================================
const PROXY_USER = 'pHW3Go';
const PROXY_PASS = 'fKrdbn';
const PROXY_IP = '23.229.76.144';
const PROXY_PORT = '8000';
const proxyUrl = `http://${PROXY_USER}:${PROXY_PASS}@${PROXY_IP}:${PROXY_PORT}`;
const proxyAgent = new HttpsProxyAgent(proxyUrl);

// App Config
const appConfig = {
  BOT_NAME: 'MARIA-MM',
  PREFIX: '.',
  CREATOR: '256743668990',
  FOOTER: 'MarkMellon the Creator',
  GROUP_INVITE_LINK: 'https://chat.whatsapp.com/BmOS9yQR6b6CFtlI3p0iNg',
  GROUP_ID: '12036321@g.us',
  GROUP_NAME: 'MARIA-MM'
};

// Middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'maria-pairing-site')));

// ============================================
// ROUTES
// ============================================

app.get('/', (req: Request, res: Response) => {
  res.sendFile(path.join(__dirname, 'maria-pairing-site', 'index.html'));
});

app.get('/api/config', (req: Request, res: Response) => {
  res.json({
    BOT_NAME: appConfig.BOT_NAME,
    PREFIX: appConfig.PREFIX,
    CREATOR: appConfig.CREATOR,
    FOOTER: appConfig.FOOTER,
    GROUP_LINK: appConfig.GROUP_INVITE_LINK,
    status: 'online'
  });
});

app.get('/health', (req: Request, res: Response) => {
  res.json({
    status: 'ok',
    service: 'MARIA-MM Pairing Server',
    uptime: Math.floor(process.uptime()),
    time: new Date().toISOString()
  });
});

// ============================================
// QR CODE SESSION MANAGER & ENDPOINTS
// ============================================
const qrSockets = new Map<string, { sock: WASocket, status: string }>();

app.get('/api/qr', async (req: Request, res: Response) => {
  const reqId = Date.now().toString(36);
  let tempFolder = path.join(__dirname, `temp_qr_${reqId}`);
  
  try {
    if (fs.existsSync(tempFolder)) fs.rmSync(tempFolder, { recursive: true, force: true });
    fs.mkdirSync(tempFolder, { recursive: true });

    const { state, saveCreds } = await useMultiFileAuthState(tempFolder);
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
      version,
      auth: state,
      logger,
      browser: Browsers.ubuntu('MARIA-MM'),
      printQRInTerminal: false,
      agent: proxyAgent
    });

    qrSockets.set(reqId, { sock, status: 'connecting' });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
      const { connection, qr, lastDisconnect } = update;
      
      // 1. When QR is ready, send it to the frontend
      if (qr) {
        qrSockets.get(reqId)!.status = 'qr_ready';
        if (!res.headersSent) {
          res.json({ success: true, reqId: reqId, qr: qr });
        }
      }
      
      // 2. When user scans and connects
      if (connection === 'open') {
        const userJid = sock.user?.id; // Gets the user's WhatsApp JID
        const credsPath = path.join(tempFolder, 'creds.json');
        
        if (fs.existsSync(credsPath)) {
          const credsData = fs.readFileSync(credsPath, 'utf-8');
          const sessionId = Buffer.from(credsData).toString('base64');
          qrSockets.set(reqId, { sock, status: 'connected' });
          
          // Send the Session ID directly to the user's WhatsApp inbox!
          if (userJid) {
            try {
              await sock.sendMessage(userJid, { 
                text: `✅ *${appConfig.BOT_NAME} Connected Successfully!*\n\n` +
                      `*YOUR SESSION ID:*\n` +
                      `\`\`\`${sessionId}\`\`\`\n\n` +
                      `Go to the MARIA-MM Hosting Panel, copy and paste this ID, and click "Start Bot" to activate your bot!`
              });
              console.log(`[QR #${reqId}] ✅ Session ID sent to user's WhatsApp inbox!`);
            } catch (e) {
              console.error(`[QR #${reqId}] Failed to send Session ID:`, e);
            }
          }
        }
        
        // Cleanup socket after 10 seconds
        setTimeout(() => {
          try { sock.ev.removeAllListeners(); sock.end(); } catch {}
          try { if (fs.existsSync(tempFolder)) fs.rmSync(tempFolder, { recursive: true, force: true }); } catch {}
          qrSockets.delete(reqId);
        }, 10000);
      }
      
      // 3. Handle connection close/errors
      if (connection === 'close') {
        if (!res.headersSent) {
          res.status(500).json({ error: 'Connection closed. Please refresh.' });
        }
        try { sock.ev.removeAllListeners(); sock.end(); } catch {}
        try { if (fs.existsSync(tempFolder)) fs.rmSync(tempFolder, { recursive: true, force: true }); } catch {}
        qrSockets.delete(reqId);
      }
    });

    // Expire QR code after 60 seconds
    setTimeout(() => {
      if (qrSockets.has(reqId) && qrSockets.get(reqId)!.status !== 'connected') {
        if (!res.headersSent) {
          res.status(408).json({ error: 'QR Code expired. Please refresh.' });
        }
        try { sock.ev.removeAllListeners(); sock.end(); } catch {}
        try { if (fs.existsSync(tempFolder)) fs.rmSync(tempFolder, { recursive: true, force: true }); } catch {}
        qrSockets.delete(reqId);
      }
    }, 60000);

  } catch (err) {
    if (!res.headersSent) res.status(500).json({ error: 'Failed to generate QR code.' });
  }
});

app.get('/api/qr-status', (req: Request, res: Response) => {
  const reqId = req.query.reqId as string;
  if (!reqId || !qrSockets.has(reqId)) {
    return res.status(404).json({ error: 'QR Session expired. Please refresh.' });
  }

  const session = qrSockets.get(reqId)!;
  if (session.status === 'connected') {
    return res.json({ success: true, connected: true });
  } else {
    return res.json({ success: true, connected: false });
  }
});

// ============================================
// MAIN ENDPOINT: POST /pair
// ============================================
app.post('/pair', async (req: Request, res: Response) => {
  const reqId = Date.now().toString(36);
  const { number } = req.body as { number ?: string };
  
  let sock: WASocket | null = null;
  let tempFolder: string = path.join(__dirname, `temp_${reqId}`);
  let isCleanedUp = false;
  
  console.log(`[PAIR #${reqId}] Request received for: ${number}`);
  
  // ============================================
  // CLEANUP UTILITY (Idempotent)
  // ============================================
  const cleanup = (): void => {
    if (isCleanedUp) return;
    isCleanedUp = true;
    
    console.log(`[PAIR #${reqId}] Cleanup started`);
    
    try {
      if (sock?.ev) {
        sock.ev.removeAllListeners();
      }
      if (sock?.ws) {
        sock.end(new Error('Cleanup triggered'));
      }
    } catch (err) {
      console.error(`[PAIR #${reqId}] Socket cleanup error:`, err instanceof Error ? err.message : String(err));
    }
    
    // Delay folder deletion to ensure FS unlocks
    setTimeout(() => {
      try {
        if (fs.existsSync(tempFolder)) {
          fs.rmSync(tempFolder, { recursive: true, force: true });
          console.log(`[PAIR #${reqId}] Cleanup completed`);
        }
      } catch (err) {
        console.error(`[PAIR #${reqId}] Folder deletion error:`, err instanceof Error ? err.message : String(err));
      }
    }, 3000);
  };
  
  try {
    // ---- VALIDATION ----
    if (!number) {
      throw Object.assign(new Error('Invalid phone number'), { statusCode: 400 });
    }
    
    const cleaned = String(number).replace(/[^0-9]/g, '');
    
    if (!cleaned || cleaned.length < 8 || cleaned.length > 15) {
      throw Object.assign(new Error('Invalid phone number'), { statusCode: 400 });
    }
    
    console.log(`[PAIR #${reqId}] Cleaned number: ${cleaned}`);
    
    // ---- SETUP TEMP FOLDER ----
    if (fs.existsSync(tempFolder)) {
      fs.rmSync(tempFolder, { recursive: true, force: true });
    }
    fs.mkdirSync(tempFolder, { recursive: true });
    
    // ---- CREATE AUTH STATE ----
    console.log(`[PAIR #${reqId}] Creating auth state...`);
    const { state, saveCreds } = await useMultiFileAuthState(tempFolder);
    
    // ---- FETCH LATEST BAILYETS VERSION ----
    const { version } = await fetchLatestBaileysVersion();
    
    // ---- CREATE SOCKET ----
    console.log(`[PAIR #${reqId}] Initializing socket...`);
    sock = makeWASocket({
      version,
      auth: state,
      logger,
      browser: Browsers.ubuntu('MARIA-MM'),
      markOnlineOnConnect: false,
      connectTimeoutMs: 60000,
      keepAliveIntervalMs: 30000,
      syncFullHistory: false,
      generateHighQualityLinkPreview: false,
      printQRInTerminal: false,
      agent: proxyAgent
    });
    
    // Register creds.update immediately
    sock.ev.on('creds.update', saveCreds);
    
    // ---- WAIT FOR SOCKET TO BE READY ----
    await new Promise<void>((resolve, reject) => {
      let isSettled = false;
      
      const timeout = setTimeout(() => {
        if (!isSettled) {
          isSettled = true;
          console.log(`[PAIR #${reqId}] Timeout`);
          reject(new Error('Timed Out waiting for WhatsApp connection'));
        }
      }, 60000);
      
      const onConnectionUpdate = async (update: any) => {
        const { connection, qr, lastDisconnect } = update;
        
        if (connection === 'connecting') {
          console.log(`[PAIR #${reqId}] Connecting...`);
        }
        
        if (!isSettled && (qr || connection === 'open')) {
          isSettled = true;
          clearTimeout(timeout);
          console.log(`[PAIR #${reqId}] Socket ready`);
          resolve();
        }
        
        if (connection === 'open') {
          console.log(`[PAIR #${reqId}] User paired successfully!`);
          
          // --- SEND WELCOME MESSAGE & SESSION ID ---
          try {
            // 1. Send the Welcome Image
            const imageUrl = 'https://ik.imagekit.io/s95tumxuk/IMG_3935.png';
            const welcomeText = `✅ *${appConfig.BOT_NAME} Connected Successfully!*\n\n` +
              `*MODE:* public\n` +
              `*CREATOR:* ${appConfig.CREATOR}\n` +
              `*OWNER_NUMBERS:* ${appConfig.CREATOR}\n` +
              `*BOT_NAME:* ${appConfig.BOT_NAME}\n\n` +
              `${appConfig.FOOTER}`;
            
            await sock.sendMessage(cleaned + '@s.whatsapp.net', {
              image: { url: imageUrl },
              caption: welcomeText
            });
            console.log(`[PAIR #${reqId}] ✅ Welcome message sent to user!`);
            
            // 2. Generate and Send the Session ID
            const credsPath = path.join(tempFolder, 'creds.json');
            if (fs.existsSync(credsPath)) {
              const credsData = fs.readFileSync(credsPath, 'utf-8');
              const sessionId = Buffer.from(credsData).toString('base64');
              
              // Send the Session ID in a separate message so it's easy to copy
              await sock.sendMessage(cleaned + '@s.whatsapp.net', {
                text: `🔑 *YOUR SESSION ID:*\n\n` +
                  `\`\`\`${sessionId}\`\`\`\n\n` +
                  `Go to the MARIA-MM Hosting Panel, copy and paste this ID, and click "Start Bot" to activate your bot!`
              });
              console.log(`[PAIR #${reqId}] ✅ Session ID sent to user's WhatsApp inbox!`);
            }
          } catch (msgErr) {
            console.error(`[PAIR #${reqId}] Failed to send messages:`, msgErr);
          }
        }
        
        if (connection === 'close') {
          const error = lastDisconnect?.error as any;
          const statusCode = error?.output?.statusCode;
          console.error(`[PAIR #${reqId}] Connection closed`, statusCode || 'Unknown', error?.message || '');
          
          if (!isSettled) {
            isSettled = true;
            clearTimeout(timeout);
            reject(new Error('Connection Closed before opening'));
          }
        }
        
        if (connection === 'disconnect') {
          console.error(`[PAIR #${reqId}] Disconnect detected`);
        }
      };
      
      sock?.ev.on('connection.update', onConnectionUpdate);
    });
    
    // ---- DELAY BEFORE REQUESTING CODE ----
    console.log(`[PAIR #${reqId}] Waiting before requesting code...`);
    await delay(3000);
    
    // ---- REQUEST PAIRING CODE ----
    console.log(`[PAIR #${reqId}] Requesting pairing code...`);
    
    let pairingCode: string;
    try {
      pairingCode = await sock.requestPairingCode(cleaned);
      console.log(`[PAIR #${reqId}] Pairing code generated: ${pairingCode}`);
    } catch (codeErr) {
      console.error(`[PAIR #${reqId}] Pairing error:`, codeErr);
      const errMsg = codeErr instanceof Error ? codeErr.message : String(codeErr);
      if (errMsg.toLowerCase().includes('rate') || errMsg.toLowerCase().includes('already')) {
        throw Object.assign(new Error('Rate Limited'), { statusCode: 429 });
      }
      throw codeErr;
    }
    
    // ---- SEND RESPONSE ----
    const responseData = {
      success: true,
      code: pairingCode,
      number: cleaned,
      message: 'Enter this code in WhatsApp',
      groupLink: appConfig.GROUP_INVITE_LINK,
      groupName: appConfig.GROUP_NAME,
      botName: appConfig.BOT_NAME,
      instructions: [
        '1. Open WhatsApp',
        '2. Go to Linked Devices',
        '3. Select "Link with phone number"',
        `4. Enter: ${pairingCode}`,
        `5. Join group: ${appConfig.GROUP_INVITE_LINK}`
      ],
      timestamp: new Date().toISOString()
    };
    
    if (!res.headersSent) {
      res.json(responseData);
    }
    
  } catch (error: unknown) {
    const err = error as Error & { statusCode ?: number };
    const errorMsg = err?.message || 'Unknown error';
    console.error(`[PAIR #${reqId}] ❌ ERROR: ${errorMsg}`);
    
    let status = 500;
    let userMsg = 'Failed to generate pairing code. Please try again.';
    
    if (errorMsg.includes('Invalid phone')) {
      status = 400;
      userMsg = 'Invalid phone number format.';
    } else if (errorMsg.includes('Timed Out')) {
      status = 408;
      userMsg = 'Connection timed out. Please try again.';
    } else if (errorMsg.includes('Rate Limited')) {
      status = 429;
      userMsg = 'Too many requests. Please wait a few minutes.';
    } else if (errorMsg.includes('Connection Closed') || errorMsg.includes('Connection Lost')) {
      status = 503;
      userMsg = 'WhatsApp service unavailable. Please try again.';
    } else if (errorMsg.includes('Restart Required')) {
      status = 500;
      userMsg = 'Server temporarily unavailable. Please try again.';
    } else if (errorMsg.includes('Logged Out')) {
      status = 401;
      userMsg = 'Session invalid. Please try again.';
    } else if (errorMsg.includes('Bad Session')) {
      status = 401;
      userMsg = 'Bad session. Please try again.';
    } else if (errorMsg.includes('ECONNREFUSED') || errorMsg.includes('Network') || errorMsg.includes('ENOTFOUND')) {
      status = 503;
      userMsg = 'Network error. Cannot reach WhatsApp.';
    } else if (err?.statusCode) {
      status = err.statusCode;
      if (status === 400) userMsg = 'Invalid phone number format.';
    }
    
    if (!res.headersSent) {
      res.status(status).json({
        success: false,
        error: userMsg,
        timestamp: new Date().toISOString()
      });
    }
  } finally {
    // Keep socket alive for 3 minutes to allow user to type the code
    setTimeout(() => {
      cleanup();
    }, 180000);
  }
});

// ============================================
// ERROR HANDLING MIDDLEWARE
// ============================================

app.use((req: Request, res: Response) => {
  res.status(404).json({
    success: false,
    error: `Not found: ${req.method} ${req.url}`
  });
});

app.use((err: unknown, req: Request, res: Response, next: NextFunction) => {
  console.error('[SERVER] Unhandled Error:', err instanceof Error ? err.message : String(err));
  if (!res.headersSent) {
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

// ============================================
// START SERVER
// ============================================
app.listen(PORT, () => {
  console.log('');
  console.log('╔════════════════════════════════════════════╗');
  console.log('║                                            ║');
  console.log('║      🚀 MARIA-MM PAIRING SERVER v4.4       ║');
  console.log('║      (Baileys v7 + Proxy Bypass)           ║');
  console.log('║                                            ║');
  console.log(`║      🌐 Listening on port ${PORT}             ║`);
  console.log('║      ✅ Status: ONLINE                      ║');
  console.log('║                                            ║');
  console.log('╚════════════════════════════════════════════╝');
  console.log('');
  console.log('Available Endpoints:');
  console.log(`  🌍 GET  /             → Pairing Website`);
  console.log(`  🔗 POST /pair         → Generate Pairing Code`);
  console.log(`  ⚙️  GET  /api/config   → Server Config`);
  console.log(`  ❤️  GET  /health      → Health Check`);
  console.log('');
});
