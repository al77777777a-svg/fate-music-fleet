# ربط التخزين الدائم والـ 24 ساعة بالبوت

ما شفت كود `src` حقك، فهذي ملفات جاهزة تنحط جنبه. تحتاج تعدّل مكانين بس.

## الملفات

| الملف | وش يسوي |
|---|---|
| `src/store.mjs` | تخزين دائم في ملف JSON (حفظ ذري، يتحمّل بعد restart) |
| `src/perms.mjs` | مستويات الصلاحيات (الكل / أدمن / أونر / أونر كل البوتات) وأوامر `addowner` و`removeowner` و`ownerlist` و`addownerall` و`removeownerall` |
| `src/settings.mjs` | `prefix` و`chat` و`settings` و`buttons` و`embed` و`playinvc` و`lang` و`platform` و`ecolor`، وأخواتها لكل البوتات: `buttonsall` و`embedall` و`playinvcall` و`langall` و`platformall` و`chatall` و`ecolorall` |
| `src/stay247.mjs` | `come` و`leave` و`setup` و`comeall` و`setupall` و`checkchannelall`، مع رجوع البوت لرومه بعد restart أو لو انفصل |
| `test/stay247.test.mjs` | 7 اختبارات، شغّلها بـ `node --test "test/*.test.mjs"` |

الملفات بصيغة `.mjs`. تشتغل من ESM أو CommonJS على Node 22.12 وما فوق.

## 1. Railway: لازم Volume

بدون Volume ملف الإعدادات يضيع مع كل deploy.

1. في خدمتك على Railway: Settings ← Volumes ← Add Volume، وخل مسار الـ mount هو `/data`.
2. أضف المتغير `DATA_DIR=/data`.
3. إذا شغّلت من جهازك بدل Railway، لا تحتاج شي، الملف ينحفظ في مجلد `data/` بجنب المشروع.

## 2. إنشاء الوحدات (مرة وحدة، بعد ما تجهز كل الكلاينتات)

```js
import { store } from './store.mjs';
import { createStay247 } from './stay247.mjs';
import { createOwnerCommands } from './perms.mjs';
import { createSettings, settingsOf, prefixOf, chatAllowed } from './settings.mjs';

const clients = [/* كل كلاينتات الأسطول العشرة */];
const stay = createStay247({ store, clients });
const owners = createOwnerCommands({ store });
const settings = createSettings({ store, clients });

for (const client of clients) stay.attach(client); // يرجّع البوت لرومه بعد restart
```

في CommonJS استخدم `const { store } = require('./store.mjs')` وبقية الاستيرادات بنفس الطريقة.

## 3. الموجّه (router) حق الأوامر

في المكان اللي عندك يحدد البوت المخاطَب ويفصل الأمر عن البادئة أو المنشن، أضف قبل بقية الأوامر:

```js
if (await stay.handle({ client, message, command, args })) return;
if (await owners.handle({ client, message, command, args })) return;
if (await settings.handle({ client, message, command, args })) return;
```

- `command` بدون بادئة ومنشن (مثلاً `come`)، و`args` مصفوفة الكلمات بعده.
- `client` هو البوت اللي استلم الرسالة، يعني `message.client`.
- ما سجّلت `join` كاختصار لـ `come` لأنه عندك مستخدم لاستدعاء بوت متاح.

## 4. ربط الإعدادات بكودك الحالي

الوحدة تخزّن الإعدادات بس، وكودك هو اللي يقراها. ثلاث نقاط:

```js
// البادئة: رقم البوت (0، 1، 2…) إلى أن يغيّرها الأدمن، و none تشيلها
const prefix = prefixOf(store, guild.id, client.user.id, botIndex);

// شات الأوامر: تجاهل الرسالة إذا رجّعت false
if (!chatAllowed(store, message, client.user.id)) return;

// المنصة والإمبد والأزرار والتشغيل بالروم واللغة
const { platform, embed, buttons, playinvc, lang, ecolor } = settingsOf(store, guild.id, client.user.id);
```

- `platform` قيمته `youtube` أو `soundcloud`: استخدمه في البحث بالاسم.
- `playinvc` يتحكم في "اكتب اسم الأغنية مباشرة". الافتراضي `true` عشان يبقى مثل سلوكك الحالي، و`playinvcall off` يطفيه.
- `embed` و`buttons` و`ecolor` و`lang` لازم يقراها كود الردود عندك لتغيّر شكله، ما أقدر أربطها بدون ما أشوفه.

## ملاحظات مهمة

- **الاتصال الصوتي**: الافتراضي يستخدم `@discordjs/voice` مع `group = ايدي البوت`. إذا كودك عنده مدير اتصالات ومشغّلات صوت خاص فيه، مرّر دوالك: `createStay247({ store, clients, join: (client, channel) => ..., leave: (client, guildId) => ... })`، وإلا بيصير عندك اتصالين لنفس البوت في السيرفر.
- **setup** يغيّر اسم البوت في السيرفر (Nickname) مو الاسم العام، عشان ما يصطدم بحد ديسكورد على تغيير الاسم. يحتاج البوت صلاحية Change Nickname، وإذا ما قدر يظل مثبّت في الروم عادي.
- **الرجوع التلقائي**: لو انفصل البوت من الروم (مو بأمر `leave`) يرجع بعد 3 ثواني، وأقصى 5 محاولات في الدقيقة. لو أحد سحبه لروم ثاني ما يرجّعه.
- **comeall و setupall**: يدخّلون البوتات بفاصل 400ms بينها عشان ما يضربون حدود الـ gateway.
- **الأونرات**: `OWNER_IDS` عندك تصير "صاحب الاشتراك" وهو أونر لكل البوتات. مستويات الأوامر: `come` و`leave` للأدمن، و`setup` و`comeall` للأونر، و`setupall` و`checkchannelall` لأونر كل البوتات.

## اللي ما سويته بعد

مشكلة يوتيوب على Railway (شرحها تحت)، ولوحات `#mp` و`@bot vip` والأزرار، وأوامر الشكل (`avatarall` و`nameall` و`gameall`)، و`dash`. أغلبها يعتمد على نفس التخزين، فبعد ما تتأكد إن هذا الجزء يشتغل نكمل عليه.

## يوتيوب

الكود ما يقدر يحل `LOGIN_REQUIRED` من Railway، لأن YouTube يرفض عناوين مراكز البيانات نفسها. المحرك اللي حدّثتوه شغّال أصلاً عندك محلياً.

- **الحل اللي يشتغل**: شغّل البوتات من جهاز بعنوان بيتي (جهازك أو ميني PC)، وأوقف نسخة Railway حتى ما يشتغل كل بوت مرتين.
- **على Railway**: خل `platform` على `soundcloud`، وكل بوت ينفع يتحدد له بـ `platformall soundcloud`.
- الأوامر والإعدادات في هذي الملفات تشتغل بنفس الطريقة في الحالتين.
