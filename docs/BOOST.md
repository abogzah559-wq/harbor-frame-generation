# Harbor Boost — frame generation & upscaling for Harbor's player

A community build of [Harbor](https://github.com/harborstremio/harbor) that adds
**Boost** to the native (mpv) player on Windows:

- **AI frame generation (RIFE)** through VapourSynth inside Harbor's own mpv.
  24 fps films play at 48/60+ fps. No external program needed.
- **Smooth** mode: light frame blending to your refresh rate, works on any GPU.
- **Upscaling** with FSR / NIS / CAS shaders and adjustable sharpness.
- **Processing resolution** (new): *Auto* plays at full quality and, when the GPU
  can't keep up (mpv starts dropping frames), steps down to 1440p, then 1080p by
  itself. 4K films now work on mid-range cards such as the RTX 5070.
- Fully translated settings panel (English / العربية), drawn with Harbor's own
  theme tokens.

Runtime pieces (Python embed, VapourSynth, RIFE ncnn-Vulkan, one model,
≈60 MB) are downloaded once, the first time you switch frame generation on.

## Install

1. Download `Harbor_…_x64-setup.exe` from the release assets below.
2. Windows SmartScreen may warn because the installer is not code-signed:
   **More info → Run anyway**.
3. Play something, then click the ✦ button on the player bar. The gear next to it
   opens the settings.

This build does not install official Harbor updates automatically (they would
replace it and remove Boost). You can still check manually from Settings.

## Recommended settings

| GPU | Settings |
|---|---|
| RTX 4070 and up | RIFE 4.6 or 4.25 Lite, ×2, Processing resolution: Auto |
| RTX 3060 – 4060, RTX 5070 | RIFE 4.6, ×2, Auto (4K will run at 1440p) |
| Older / integrated GPUs | Smooth mode |

RIFE 4.26 with *Target FPS 60* on a 4K source is the heaviest combination;
leave Processing resolution on *Auto* if you use it.

---

# Harbor Boost — توليد الفريمات والتكبير داخل مشغّل Harbor

نسخة مجتمعية من Harbor تضيف **Boost** للمشغّل على ويندوز:

- **توليد فريمات بالذكاء الاصطناعي (RIFE)** داخل مشغّل Harbor نفسه، بدون أي برنامج ثاني. الأفلام اللي على 24 فريم تصير 48 أو 60 وأكثر.
- **وضع سلس**: دمج خفيف للفريمات على تردّد شاشتك، يشتغل على أي كرت.
- **تكبير** بـ FSR أو NIS أو CAS مع التحكم بالحدّة.
- **دقة المعالجة** (جديد): الوضع *التلقائي* يشتغل بجودة كاملة، ولو كرتك ما لحق ينزل لحاله إلى 1440p ثم 1080p. يعني أفلام 4K صارت تشتغل على الكروت المتوسطة مثل RTX 5070.
- إعدادات كاملة بالعربي والإنجليزي، وبنفس شكل Harbor.

أول مرة تشغّل توليد الفريمات يتحمّل تقريبًا 60 ميجا مرة وحدة بس.

## التثبيت

1. حمّل ملف `Harbor_…_x64-setup.exe` من الملفات تحت.
2. لو طلع تحذير ويندوز الأزرق، اضغط **More info** ثم **Run anyway** (الملف غير موقّع).
3. شغّل أي فيلم واضغط زر ✦ في شريط المشغّل. الترس اللي جنبه يفتح الإعدادات.

هذي النسخة ما تثبّت تحديثات Harbor الرسمية تلقائيًا، لأنها بتستبدلها وتشيل Boost. تقدر تشيّك على التحديثات يدويًا من الإعدادات.

## الإعدادات المقترحة

| الكرت | الإعدادات |
|---|---|
| RTX 4070 وأعلى | RIFE 4.6 أو 4.25 Lite، ×2، دقة المعالجة: تلقائي |
| من RTX 3060 إلى 4060، وRTX 5070 | RIFE 4.6، ×2، تلقائي (أفلام 4K تشتغل على 1440p) |
| الكروت القديمة أو المدمجة | الوضع السلس |

أثقل شي هو RIFE 4.26 مع 60 فريم مستهدفة على فيلم 4K. لو تستخدمه خلّ دقة المعالجة على *تلقائي*.
