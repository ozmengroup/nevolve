# nevolve.ai - Oturum Notları
> Son güncelleme: 10 Aralık 2024 (Oturum 4)

---

## Proje Durumu: v4.3.0

**Site URL:** https://burhansimsek.space/isthatpossible/
**Repo:** github.com/ozmengroup/nevolve
**Auto-deploy:** GitHub push → Hostinger otomatik güncelleme

---

## Son Oturum (10 Aralık - Oturum 4)

### Yapılanlar

**1. Multi-Model Mimari Eklendi (Groq + Gemini)**
```
Groq API (100K token/gün)
├── Dava tipi algılama (~100 token)
└── Ana yanıt (~800 token)

Gemini API (ayrı limit)
└── Karar özetleme (~4000 → ~200 token)
```

**2. Gemini Özetleme Fonksiyonu (api.js:278)**
```javascript
async summarizeKararWithGemini(kararContent, meta = {})
// Karar metnini alıp yapılandırılmış özet döndürür:
// SONUÇ, KONU, GEREKÇE, EMSAL DEĞERİ
```

**3. Token Optimizasyonu**
- Eski: ~5000 token/sorgu
- Yeni: ~1250 token/sorgu (Gemini özetleriyle)
- **%75 tasarruf**

### Test Sonuçları

✅ **Çalışan:**
- Dava tipi algılama: İş Hukuku doğru tespit edildi
- Doğru daire: 9. Hukuk Dairesi kararları geldi
- Mevzuat: İş Kanunu m.18, m.20 bulundu
- Fallback: Gemini 429 verdiğinde sistem çalışmaya devam etti

❌ **Sorunlar:**
- Groq rate limit: 100K token/gün doldu
- Gemini 429: gemini-2.0-flash rate limit (gemini-1.5-flash'a geçildi)
- CORS hatası: Yargıtay document API'sinde

---

## Kritik Limitler

| API | Limit | Durum |
|-----|-------|-------|
| Groq | 100K token/gün | DOLDU (UTC 00:00'da sıfırlanır) |
| Gemini 1.5 Flash | 1500 istek/gün | Aktif |
| Yargıtay API | Sınırsız | CORS sorunu var |

---

## Yarın Yapılacaklar

### Öncelikli
1. [ ] Groq limit yenilendikten sonra test
2. [ ] Token optimizasyonu (system prompt kısaltma)
3. [ ] CORS proxy çözümü (Yargıtay document API)

### Token Optimizasyon Planı
```
Mevcut: ~3000 token/sorgu → ~33 sorgu/gün
Hedef:  ~1000 token/sorgu → ~100 sorgu/gün

Yapılacaklar:
- System prompt: 600 → 300 token
- History: 6 → 4 mesaj
- Gemini özetleri aktif tutulacak
```

### Alternatif Çözümler (Backlog)
- [ ] OpenRouter entegrasyonu (birden fazla model)
- [ ] Cloudflare Workers AI (ücretsiz tier)
- [ ] Groq paid tier ($0.05/1M token)

---

## Önceki Oturum Notları (Oturum 3)

### Kritik Sorun: Yanlış Daire Kararları (ÇÖZÜLDÜ ✅)
**Sorun:** İş davası sorulduğunda 11. Ceza Dairesi, 12. Hukuk Dairesi kararları geliyordu

**Çözüm:**
- Kanun numarası öncelikli arama (4857 = İş Kanunu)
- Client-side daire filtreleme
- AI-based dava tipi algılama

---

## Teknik Notlar

### Dosya Yapısı
```
/nevolve
├── index.html          # Ana uygulama
├── js/
│   ├── config.js       # System prompt, API keys, AI ayarları
│   └── api.js          # API + Daire filtreleme + Gemini özetleme
└── SESSION_NOTES.md
```

### Önemli Fonksiyonlar (api.js)
- `summarizeKararWithGemini()` - Gemini ile karar özetleme (YENİ)
- `searchCases(keyword, timeout, daire)` - Daire filtreli arama
- `detectCaseTypeAI()` - AI ile dava tipi algılama
- `buildEnrichedContext(question)` - Akıllı kaynak toplama
- `buildStructuredContext()` - Gemini özetlerini kullanır

### API Endpoints
```
Groq:    https://nevolve-api.burhan-simsek.workers.dev
Gemini:  https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash
Yargıtay: https://yargi-api.onrender.com
```

---

## Yeni Oturumda Devam Etmek İçin

```
"SESSION_NOTES.md oku. Groq limiti yenilendi, token optimizasyonu yapalım."
```
