const boost: Record<string, string> = {
  "Frame generation & scaling": "توليد الفريمات والتكبير",
  "Frame Generation & Scaling": "توليد الفريمات والتكبير",
  "Frame Generation: On": "توليد الفريمات: مشغّل",
  "Frame Generation: Off": "توليد الفريمات: مطفأ",
  "Toggle frame generation": "تشغيل/إيقاف توليد الفريمات",
  "Frame generation settings": "إعدادات توليد الفريمات",
  "Runs inside Harbor's player. No other program needed.": "يشتغل داخل مشغّل Harbor نفسه، بدون أي برنامج ثاني.",
  "Reset to defaults": "استعادة الافتراضي",
  "Adaptive: target 0 follows your screen's refresh rate (capped at it).":
    "التكيّفي: لو الهدف 0 يتبع تردّد شاشتك (وما يتجاوزه).",
  "Tip: X2 on a 24 fps episode gives 48 fps. Higher needs a strong GPU.":
    "ملاحظة: X2 على حلقة 24 فريم تعطيك 48 فريم. الأعلى يحتاج كرت شاشة قوي.",
  "Blends frames to your screen's refresh rate. Very light, works on any GPU.":
    "يمزج الفريمات على تردّد شاشتك. خفيف جدًا ويشتغل على أي كرت.",
  "Stay on for the next episodes": "يبقى شغّال للحلقات الجاية",
  Downloading: "جارٍ تحميل",
  "Working…": "جارٍ التجهيز…",
  "About 60 MB downloads once, the first time you turn it on.": "يتحمّل تقريبًا 60 ميجا مرة وحدة، أول ما تشغّله.",
  "A small download happens once, the first time you turn it on.": "تحميل صغير مرة وحدة، أول ما تشغّله.",
  "Applying…": "جارٍ التطبيق…",
  // Boost settings panel
  "Harbor Boost": "Harbor Boost",
  "Frame generation": "توليد الفريمات",
  "AI (RIFE)": "ذكاء اصطناعي (RIFE)",
  Smooth: "سلس",
  "Creates new in-between frames with AI. Smoothest, needs a capable GPU.":
    "يصنع فريمات جديدة بين الفريمات بالذكاء الاصطناعي. الأنعم، ويحتاج كرت شاشة قوي.",
  "Frame generation is off. Upscaling can still be used.": "توليد الفريمات مطفأ. تقدر تستخدم التكبير لحاله.",
  Fastest: "الأسرع",
  Fast: "سريع",
  Balanced: "متوازن",
  "Best quality": "أعلى جودة",
  Output: "الناتج",
  Multiplier: "مضاعِف",
  "Target FPS": "فريمات مستهدفة",
  "Processing resolution": "دقة المعالجة",
  Source: "الأصلية",
  "Full quality, and steps down to 1440p or 1080p by itself if your GPU can't keep up (useful for 4K).":
    "جودة كاملة، وينزل لحاله إلى 1440p أو 1080p لو كرتك ما لحق (مفيد مع أفلام 4K).",
  "Always works at the video's own size. 4K needs a very strong GPU.":
    "يشتغل دايم على دقة الفيديو نفسها. أفلام 4K تحتاج كرت قوي جدًا.",
  "Larger videos are scaled down before frame generation, then upscaled back to your screen.":
    "الفيديو الأكبر يتصغّر قبل توليد الفريمات، وبعدين يتكبّر ويرجع لحجم شاشتك.",
  "Now: {h}p": "حاليًا: {h}p",
  "Scene detection": "كشف تغيّر المشهد",
  "Skips blending across hard cuts, so scene changes stay clean.":
    "ما يدمج بين اللقطات المختلفة، فيبقى الانتقال بين المشاهد نظيف.",
  "Faster motion estimation": "تقدير حركة أسرع",
  "Estimates motion at half resolution. Lighter, slightly less precise.":
    "يحسب الحركة على نص الدقة. أخف على الكرت، وأقل دقة بشوي.",
  Upscaling: "التكبير",
  "Sharpens the picture when it is scaled up to your screen.": "يحسّن حدّة الصورة لما تتكبّر على حجم شاشتك.",
  Sharpness: "الحدّة",
  General: "عام",
  Hide: "إخفاء",
  Show: "إظهار",
  "Graphics card": "كرت الشاشة",
  "Auto picks the dedicated GPU. Change it only if frame generation runs on the wrong one.":
    "التلقائي يختار كرت الشاشة الأساسي. غيّره بس لو توليد الفريمات اشتغل على الكرت الغلط.",
  "GPU threads": "مسارات المعالجة",
  Components: "المكوّنات",
  "Upscaling shaders": "ملفات التكبير",
  "VapourSynth runtime": "بيئة VapourSynth",
  "RIFE engine": "محرّك RIFE",
  "Model {m}": "النموذج {m}",
  Ready: "جاهز",
  "Not downloaded": "غير محمّل",
  "Your GPU couldn't keep up, so frame generation now works at {h}p.":
    "كرتك ما لحق، فصار توليد الفريمات يشتغل على {h}p.",
  "Your GPU still can't keep up. Try the RIFE 4.6 model with X2.":
    "كرتك لسا ما يلحق. جرّب نموذج RIFE 4.6 مع ×2.",
};

export default boost;
