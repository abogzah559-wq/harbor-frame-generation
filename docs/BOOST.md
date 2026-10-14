# Harbor Boost — frame generation & upscaling for Harbor's player

A community build of [Harbor](https://github.com/harborstremio/harbor) that adds
**Boost** to the native (mpv) player on Windows:

- **AI frame generation (RIFE)** through VapourSynth inside Harbor's own mpv.
  24 fps films play at 48/60+ fps. No external program needed.
- **Smooth** mode: light frame blending to your refresh rate, works on any GPU.
- **Upscaling** with FSR / NIS / CAS shaders and adjustable sharpness.
- **GPU budget planner** (new in boost-2): Boost measures RIFE's speed on
  your GPU once (a 3-4 s pause the first time), then picks the processing
  resolution (up to 1080p) and an output frame rate that divides your screen's
  refresh rate evenly, so total GPU use stays under your limit (default 80 %).
  If playback still drops frames it lowers the load by itself.
  Measured on an RTX 4070 Super with a 240 Hz screen: 4K and 1080p films play
  at 48-60 fps with no dropped frames.
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

## Settings

Leave **Output** and **Processing resolution** on *Auto* and set the **GPU
limit** you want; Boost does the rest. RIFE 4.6 is the fastest model and is
recommended for most GPUs. Heavier models (4.25 Lite, 4.26) work too; Boost
just lowers the resolution or frame rate to stay inside the limit.

---

# Harbor Boost — توليد الفريمات والتكبير داخل مشغّل Harbor

نسخة مجتمعية من Harbor تضيف **Boost** للمشغّل على ويندوز:

- **توليد فريمات بالذكاء الاصطناعي (RIFE)** داخل مشغّل Harbor نفسه، بدون أي برنامج ثاني. الأفلام اللي على 24 فريم تصير 48 أو 60 وأكثر.
- **وضع سلس**: دمج خفيف للفريمات على تردّد شاشتك، يشتغل على أي كرت.
- **تكبير** بـ FSR أو NIS أو CAS مع التحكم بالحدّة.
- **مخطط استهلاك الكرت** (جديد في boost-2): Boost يقيس قوة كرتك مرة وحدة (يوقف الفيلم 3-4 ثواني أول مرة بس)، وبعدين يختار دقة المعالجة (حتى 1080p) وعدد فريمات ينقسم على تردّد شاشتك بالتساوي، بحيث استهلاك الكرت يبقى تحت الحد اللي تختاره (الافتراضي 80%). ولو صار تقطيع يخفف الحمل لحاله. تجربة على RTX 4070 Super وشاشة 240Hz: أفلام 4K و1080p تشتغل على 48-60 فريم بدون أي فريم ضايع.
- إعدادات كاملة بالعربي والإنجليزي، وبنفس شكل Harbor.

أول مرة تشغّل توليد الفريمات يتحمّل تقريبًا 60 ميجا مرة وحدة بس.

## التثبيت

1. حمّل ملف `Harbor_…_x64-setup.exe` من الملفات تحت.
2. لو طلع تحذير ويندوز الأزرق، اضغط **More info** ثم **Run anyway** (الملف غير موقّع).
3. شغّل أي فيلم واضغط زر ✦ في شريط المشغّل. الترس اللي جنبه يفتح الإعدادات.

هذي النسخة ما تثبّت تحديثات Harbor الرسمية تلقائيًا، لأنها بتستبدلها وتشيل Boost. تقدر تشيّك على التحديثات يدويًا من الإعدادات.

## الإعدادات

خلّ **الناتج** و**دقة المعالجة** على *تلقائي*، واختر **حد استهلاك الكرت** اللي يناسبك، والباقي على Boost. نموذج RIFE 4.6 الأسرع وننصح فيه لأغلب الكروت. النماذج الأثقل (4.25 Lite و4.26) تشتغل بعد، بس Boost بينزّل الدقة أو الفريمات عشان يبقى تحت الحد.
