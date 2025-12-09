# nevolve.ai - Oturum Notları
> Son güncelleme: 10 Aralık 2024 (Oturum 3)

---

## Proje Durumu: v4.2.1

**Site URL:** https://burhansimsek.space/isthatpossible/
**Repo:** github.com/ozmengroup/nevolve
**Auto-deploy:** GitHub push → Hostinger otomatik güncelleme

---

## Son Oturum (10 Aralık - Oturum 3)

### Kritik Sorun: Yanlış Daire Kararları
**Sorun:** İş davası sorulduğunda 11. Ceza Dairesi, 12. Hukuk Dairesi kararları geliyordu

**Kök Neden Analizi:**
- Yargıtay API `daire` parametresini destekliyor ama tam filtrelemiyor
- "kıdem tazminatı", "ihbar tazminatı" aramaları hiç 9. Hukuk Dairesi döndürmüyor
- **Kritik Bulgu:** "4857" (İş Kanunu numarası) araması %100 9. HD döndürüyor!

**Test Sonuçları:**
```
"4857"      → %100 9. Hukuk Dairesi ✅
"işçi"      → %60 9. Hukuk Dairesi
"işveren"   → %50 9. Hukuk Dairesi
"kıdem tazminatı" → %0 9. HD ❌
"işe iade"  → %0 9. HD ❌
```

### Yapılan İyileştirmeler (api.js)

**1. Daire Eşleştirmesi Eklendi:**
```javascript
KANUN_MAP: {
    ceza: { daireler: ['Ceza Dairesi', 'Ceza Genel Kurulu'], ... },
    icra: { daireler: ['12. Hukuk Dairesi'], ... },
    aile: { daireler: ['2. Hukuk Dairesi'], ... },
    is: { daireler: ['9. Hukuk Dairesi'], ... },
    idari: { daireler: [], ... },  // Danıştay
    miras: { daireler: ['1. Hukuk Dairesi', '14. Hukuk Dairesi'], ... }
}
```

**2. searchCases() Fonksiyonu Güncellendi:**
- `daire` parametresi eklendi
- Client-side filtreleme eklendi (API'nin eksik filtresi için)

**3. Arama Stratejisi Değiştirildi:**
```javascript
// ESKİ (çalışmıyordu):
is: ['işe iade', 'fesih', 'tazminat']

// YENİ (kanun numaraları öncelikli):
is: ['4857', 'işçi', 'işveren', 'fesih']  // 4857 = İş Kanunu
ceza: ['5237', 'TCK', 'savunma', 'beraat']  // 5237 = TCK
icra: ['2004', 'İİK', 'itiraz', 'menfi tespit']  // 2004 = İİK
```

**4. Kanun Numarası Önceliği:**
- İş davası algılandığında önce "4857" ile aranıyor
- Bu sayede %100 doğru daire (9. HD) geliyor

---

## Puppeteer MCP Durumu
**Sorun:** `detached Frame` hatası devam ediyor
**Gerekli:** Claude Code yeniden başlatılması

---

## Devam Edilecek İşler

### Hemen Yapılacak
1. [x] API kaynak analizi tamamlandı
2. [x] Daire filtreleme eklendi
3. [ ] GitHub'a push et (deploy)
4. [ ] Siteyi test et
5. [ ] Puppeteer MCP'yi düzelt (Claude Code restart)

### Backlog
- [ ] Dark mode
- [ ] PDF export
- [ ] Arama geçmişi

---

## API Bulguları (Test Sonuçları)

### Çalışan Aramalar (Doğru Daire)
| Arama | 9. HD Oranı |
|-------|-------------|
| 4857 | %100 |
| işçi | %60 |
| işveren | %50 |
| fesih | %70 (daire filtresiyle) |
| dolandırıcılık | %100 Ceza Dairesi |

### Çalışmayan Aramalar
| Arama | Sorun |
|-------|-------|
| kıdem tazminatı | %0 9. HD |
| ihbar tazminatı | %0 9. HD |
| işe iade | %0 9. HD |
| iş sözleşmesi | %0 9. HD |

**Sonuç:** Kanun numaraları (4857, 5237, 2004) en güvenilir arama terimleri

---

## Teknik Notlar

### Dosya Yapısı
```
/nevolve
├── index.html      # Ana uygulama
├── js/
│   ├── config.js   # System prompt, AI ayarları
│   └── api.js      # API + Daire filtreleme sistemi (v4.2.1)
└── SESSION_NOTES.md
```

### Önemli Fonksiyonlar (api.js)
- `searchCases(keyword, timeout, daire)` - Daire filtreli arama
- `generateSearchQueries(question, caseType)` - Kanun numarası öncelikli sorgular
- `detectCaseType(question)` - Dava tipi algılama
- `buildEnrichedContext(question)` - Akıllı kaynak toplama

---

## Yeni Oturumda Devam Etmek İçin

```
"SESSION_NOTES.md oku. GitHub'a push edip siteyi test edelim."
```
