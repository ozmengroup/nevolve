// nevolve.ai Configuration
const CONFIG = {
    // API Endpoints
    YARGI_API: 'https://yargi-api.onrender.com',
    GEMINI_API: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent',
    GEMINI_KEY: 'AIzaSyDL4rz3oNYEW55VxbLisbAsEAL4g3cKG9U',
    
    // AI Settings
    AI_SYSTEM_PROMPT: `Sen deneyimli bir Türk hukuku uzmanısın. Avukatlara stratejik danışmanlık veriyorsun.

Yanıtlarında:
- Pratik ve uygulanabilir stratejiler öner
- İlgili Yargıtay kararlarına atıf yap
- Riskleri ve fırsatları belirt
- Net ve anlaşılır bir dil kullan

Türkçe yanıt ver.`,
    
    AI_CONFIG: {
        temperature: 0.7,
        maxOutputTokens: 2048
    },
    
    // App Info
    APP_NAME: 'nevolve.ai',
    APP_VERSION: '1.0.0'
};