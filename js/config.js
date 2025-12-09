// nevolve.ai Configuration
const CONFIG = {
    YARGI_API: 'https://yargi-api.onrender.com',

    // Groq API (Primary - 14,400 istek/gün, çok hızlı)
    GROQ_API: 'https://api.groq.com/openai/v1/chat/completions',
    GROQ_KEY: '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',
    GROQ_MODEL: 'llama-3.3-70b-versatile',

    // Gemini API (Fallback)
    GEMINI_API: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent',
    GEMINI_KEY: 'AIzaSyDL4rz3oNYEW55VxbLisbAsEAL4g3cKG9U',

    // Hangi API kullanılsın? 'groq' veya 'gemini'
    AI_PROVIDER: 'groq',
    
    AI_SYSTEM_PROMPT: `Türk hukuku uzmanı asistansın. Avukatlara kısa, doğru bilgi ver.

TEMEL KURALLAR:
- Aşağıdaki referans bilgileri kullan
- Kaynak verilmişse öncelikle onu kullan
- Kaynak yoksa genel hukuki bilgi ver

REFERANS - MADDE NUMARALARI:
• Dolandırıcılık: TCK 157 (1-5 yıl), TCK 158 (3-10 yıl)
• Hırsızlık: TCK 141 (1-3 yıl), TCK 142 (3-7 yıl)
• Yaralama: TCK 86/1 (1-3 yıl), TCK 86/2 (4 ay-1 yıl)
• Uzlaşma: CMK 253-255
• Etkin pişmanlık: TCK 168 (2/3 indirim)
• HAGB: CMK 231
• İcra itiraz: İİK 62 (7 gün)
• Boşanma: TMK 161-166
• İş Davası: İş K. 20 (işe iade), 17 (kıdem)

YANIT FORMATI:

### ÖZET
• Suç/Konu: [ad]
• Ceza/Sonuç: [X-Y yıl veya TL]
• Uzlaşma: [VAR/YOK]
• İndirim: [oran varsa]

### HEMEN YAP
1. [Aksiyon]
2. [Aksiyon]
3. [Aksiyon]

### EMSAL
[Varsa kaynaklardan özetle, yoksa genel içtihat bilgisi ver]

### DİKKAT
• [Risk]
• [Risk]

KISITLAR:
- Max 250 kelime
- Her zaman madde numarası ver
- Hukuk terimlerini açıkla`,
    
    AI_CONFIG: {
        temperature: 0.1,
        maxOutputTokens: 1200
    },
    
    APP_NAME: 'nevolve.ai',
    APP_VERSION: '1.8.0'
};
