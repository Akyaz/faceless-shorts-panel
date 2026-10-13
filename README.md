# Shorts Paneli

[faceless-shorts](https://github.com/Akyaz/faceless-shorts) video üretimini telefondan yönetmek için küçük bir web uygulaması. Sunucusu yoktur: tarayıcıdan doğrudan GitHub API'sine konuşur ve iş akışlarını yönetir.

## Neler yapar

- **Durum:** Son üretilen videolar ve YouTube bağlantıları, son çalışmaların başarılı ya da başarısız olduğu.
- **Üret:** Tür ve adet seçip video üretimini başlatır; haftalık derlemeyi başlatır.
- **Anahtarlar:** Otomatik yayını durdurur ve başlatır; yeni videoların herkese açık ya da gizli yüklenmesini seçer.

## Kurulum

1. GitHub'da **Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token**.
2. **Repository access:** "Only select repositories" → yalnızca `faceless-shorts`.
3. **Repository permissions:**
   - Actions: Read and write
   - Variables: Read and write
   - Contents: Read-only
4. Paneli telefonda aç, **Ayarlar** ekranına depoyu (`sahip/faceless-shorts`) ve anahtarı gir.
5. Tarayıcı menüsünden **Ana ekrana ekle** de; panel uygulama gibi açılır.

Anahtar yalnızca o cihazın tarayıcı deposunda saklanır ve yalnızca `api.github.com` adresine gönderilir. Telefonu kaybedersen anahtarı GitHub'dan iptal et.

## Yapı

| Dosya | İş |
| --- | --- |
| `api.js` | GitHub API çağrıları; arayüzden bağımsız, Node ile sınanabilir |
| `app.js` | Ekranlar ve düğmeler |
| `sw.js` | Uygulama kabuğunu saklar; API yanıtlarını saklamaz |

Derleme adımı yoktur; dosyalar olduğu gibi yayınlanır (GitHub Pages).

Yerelde denemek için: `python3 -m http.server 8791` ve `http://127.0.0.1:8791/`.

## Pipeline ile sözleşme

Panel, faceless-shorts deposunda şunlara dayanır:

- `make-short.yml` iş akışının `mode`, `count` ve `upload` girdileri; `weekly.yml` iş akışının `upload` girdisi
- `YT_PRIVACY` depo değişkeni (`public` ya da `private`)
- `panel-data` dalındaki `feed.json`: her çalışmanın sonunda `pipeline/report.py` tarafından eklenen kayıt
