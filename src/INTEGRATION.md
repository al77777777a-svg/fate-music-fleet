# تحديث البوت: 24/7 والأونرات والإعدادات مدمجة في index.js

الوحدات (`store` و`perms` و`stay247` و`settings`) صارت مربوطة بالبوت نفسه، مو ملفات جنبه.

## ارفع هذي الملفات (استبدل القديمة)

| الملف | وين |
|---|---|
| `index.js` | `src/` |
| `room-routing.js` | `src/` |
| `player-ui.js` | `src/` |
| `stay247.mjs` | `src/` |
| `command-only.test.js` | `test/` |
| `room-routing.test.js` | `test/` |
| `.gitignore` | الرئيسي |
| `INTEGRATION.md` | الرئيسي (وتقدر تحذف النسخة اللي في `src/`) |

## قبل ما تنشر على Railway

1. أضف **Volume** للخدمة، ومسار الـ mount `/data`.
2. أضف المتغير `DATA_DIR=/data`.

بدون الـ Volume الإعدادات و24/7 تضيع مع كل deploy. وإذا شغّلت من جهازك، الملف ينحفظ في مجلد `data/` ولا يتحمّل على GitHub.

## وش تغيّر

**أوامر جديدة** (الصلاحيات حسب دليل فيت ستور):

- **أدمن**: `come` و`afk` (تثبيت 24/7) و`leave` و`prefix` و`chat` و`settings`.
- **أونر**: `setup` و`comeall` و`buttons` و`embed` و`lang` و`platform` و`ecolor` و`addowner` و`removeowner` و`ownerlist`.
- **أونر كل البوتات**: `setupall` و`checkchannelall` و`addownerall` و`removeownerall` و`buttonsall` و`embedall` و`langall` و`platformall` و`chatall` و`ecolorall` و`playinvcall`.

**كيف تنوصل الأوامر**:

- أوامر الإدارة تشتغل بالمنشن من أي شات: `@البوت come`، و`@البوت prefix !`. صلاحيتك هي اللي تحكم، مو وجودك في الروم.
- أوامر `*all` يرد عليها بوت واحد بس، أول بوت جاهز في السيرفر.
- البادئة لكل بوت: الافتراضي رقمه (`1play`). `prefix !` يخليها `!play`، و`prefix none` تلغيها.
- `chat #commands` يخلي شات نصي يقبل أوامر التشغيل، بشرط تكون داخل روم فيه بوت.

**الإعدادات اللي تأثر فعلاً**:

- `platform soundcloud`: البحث بالاسم يبدأ من SoundCloud.
- `playinvc` و`playinvcall`: التشغيل بكتابة اسم الأغنية.
- `embed`: رد التشغيل يطلع كرت.
- `buttons`: أزرار التحكم تحت رد التشغيل.
- `ecolor`: لون الكرت.

**الرجوع التلقائي**: البوت المثبّت يرجع لرومه بعد restart، وإذا انفصل يرجع بعد 3 ثواني.

## تغييرات في السلوك القديم

- `leave` و`settings` صارت للأدمن فقط (كانت لأي عضو في الروم).
- `come` و`afk` صارت تثبيت 24/7 للأدمن. أما `join` و`تعال` فتظل استدعاء مؤقت للجميع.
- `playinvcall` صار يطبّق على كل البوتات ويبقى بعد restart، وكان لبوت واحد بالذاكرة.
- خطأ `Got 404 from the request` اللي ظهر عندك: فشل بحث SoundCloud ما عاد يوقف الأمر، وإذا فشلت المصادر كلها تطلع رسالة واضحة فيها سبب الفشل.

## ما انعمل بعد

- `lang` يتخزّن لكن الردود كلها عربي حالياً.
- لوحات `#mp` و`@bot vip`، وأوامر `avatarall` و`nameall` و`gameall` و`statusall`، و`dash`، و`restartall`، و`settempall`.
- يوتيوب على Railway: عنوان السيرفر محجوب من YouTube، والحل تشغيل البوتات من جهاز بعنوان بيتي. ولحد ذلك خل `platformall soundcloud`.

## كيف جرّبت

- 37 اختبار وحدة نجحت، منها اختبارات جديدة لمسار الإدارة والبادئات وشات الأوامر.
- شغّلت `index.js` الحقيقي بمكتبات ديسكورد وهمية وأرسلت له رسائل مزيفة: `come` و`leave` و`comeall` و`setupall` و`prefix`، وإعادة تشغيل العملية ورجوع البوتات لرومها.
- ما جرّبته على ديسكورد الحقيقي. أول ما تنشر، جرّب `come` في روم، ثم أعد النشر من Railway وشوف إن البوت يرجع لرومه.
