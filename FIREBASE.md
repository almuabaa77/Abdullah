# ربط وصلة بـ Firebase

يمكن استخدام Firebase لإرسال رمز الدخول بالجوال. ويمكن أيضًا استخدام نطاق Firebase Hosting للمنصة عبر بوابة تربط المستخدمين بخادم وصلة. يحفظ خادم وصلة الحسابات والطلبات والمرفقات في SQLite على وحدة تخزين دائمة.

## تفعيل الدخول بالجوال

1. افتح مشروعك في [Firebase Console](https://console.firebase.google.com/).
2. من **Project settings → General → Your apps** اختر **Web** وسجّل تطبيقًا باسم **Waslah**. في إعدادات التطبيق اختر **Config** واحفظ القيم العامة `apiKey` و`authDomain` و`projectId` و`appId`.
3. افتح **Build → Authentication → Sign-in method** وفعّل **Phone**. راجع الفوترة وسياسة مناطق الرسائل واسمح بالدول التي ستستخدمها. تتطلب رسائل التحقق الفعلية استخدام خطة Blaze وفق إعدادات Firebase.
4. في **Authentication → Settings → Authorized domains** أضف النطاق الذي سيفتح المستخدمون منه المنصة، مثل `PROJECT_ID.web.app` أو نطاقك.
5. في إعدادات خادم وصلة اضبط المتغيرات التالية. حوّل إعدادات الويب إلى JSON بسطر واحد، وضع رقم جوال المدير الدولي ومفتاح الجلسات في إعدادات الخادم المحمية.

```dotenv
AUTH_PROVIDER=firebase
FIREBASE_WEB_CONFIG={"apiKey":"COPY_WEB_API_KEY","authDomain":"PROJECT_ID.firebaseapp.com","projectId":"PROJECT_ID","appId":"COPY_WEB_APP_ID"}
ADMIN_PHONE=YOUR_ADMIN_MOBILE
SESSION_SECRET=YOUR_RANDOM_SESSION_KEY
```

`SESSION_SECRET` مفتاح عشوائي ثابت لا يقل عن 32 حرفًا. تتحقق وصلة من رمز هوية Firebase على الخادم، ثم تطبّق موافقة الإدارة والحظر والصلاحيات داخلها.

### إعداد الملف على Windows

من `cmd` داخل مجلد وصلة، شغّل هذا الأمر بالقيم العامة من تطبيق الويب في Firebase. يطلب البرنامج رقم جوال المدير ويحفظه محليًا في `.env` مع مفتاح جلسات عشوائي.

```cmd
node setup-firebase.mjs PROJECT_ID PROJECT_ID.firebaseapp.com WEB_APP_ID WEB_API_KEY
```

شغّل `npm start` لتحميل الإعدادات. إذا كان ملف `.env` موجودًا، أدخل القيم اللازمة يدويًا فيه مع الاحتفاظ بمفتاح الجلسات الحالي. للمستخدمين الذين أضافوا ملف الإعداد إلى نسخة أقدم، يمكن تشغيل `node --env-file=.env server.mjs` بعد بناء الواجهة عبر `npm run build:firebase`.

ظهور شاشة الدخول محليًا يتحقق من تحميل إعدادات وصلة. لاختبار وصول رمز حقيقي، افتح واجهة وصلة من نطاق HTTPS مضاف إلى **Authorized domains** واختر رقمًا حقيقيًا تسمح به سياسة مناطق الرسائل في Firebase.

## تشغيل خادم وصلة على تخزين دائم

على خادم Linux أو استضافة تدعم Docker وتخزينًا دائمًا، انسخ المشروع وأضف المتغيرات إلى ملف خاص مثل `.env`. ابنِ الصورة وشغّلها مع وحدة تخزين لقاعدة البيانات.

```sh
docker build -t waslah .
docker volume create waslah-data
docker run -d --name waslah --restart unless-stopped \
  --env-file .env -p 127.0.0.1:3000:3000 \
  -v waslah-data:/data waslah
```

اضبط وكيل HTTPS على الخادم لتوجيه نطاقك إلى `127.0.0.1:3000`. مثال إعداد Caddy إذا كان النطاق يشير إلى الخادم:

```caddyfile
api.example.com {
    reverse_proxy 127.0.0.1:3000
}
```

تحقّق من `https://api.example.com/api/health`. يتطلب تشغيل زر تسجيل الدخول إضافة نطاق الصفحة إلى **Authorized domains**.

## الحصول على رابط Firebase Hosting

هذه الخطوة تستخدم خدمة Cloud Run كبوابة HTTPS. تحتاج مشروعًا مصرحًا لك بالنشر فيه وفوترة مفعّلة في Google Cloud. يفترض المثال أن خادم وصلة يعمل على `https://api.example.com` وأن أدوات `gcloud` و`firebase` متاحة لديك.

1. أضف `FIREBASE_HOSTING=1` إلى إعدادات خادم وصلة قبل تشغيله. إذا كانت حاوية Docker تعمل بالفعل، أعد إنشاء الحاوية مع إعادة توصيل وحدة التخزين `waslah-data`. يستخدم الخادم اسم ملف الجلسة `__session` الذي يمرره Firebase Hosting.
2. انشر بوابة Cloud Run من جذر المشروع. استبدل `PROJECT_ID` بمعرّف مشروعك و`https://api.example.com` بعنوان خادم وصلة الفعلي.

```sh
gcloud auth login
gcloud run deploy waslah-gateway \
  --project PROJECT_ID --region europe-west1 \
  --source firebase-gateway --allow-unauthenticated \
  --set-env-vars WASLAH_ORIGIN=https://api.example.com
```

3. انشر إعداد Hosting الموجود في `firebase.json` ثم افتح الرابط الذي يعرضه Firebase. أضف نطاق ذلك الرابط إلى قائمة النطاقات المصرّح بها في Firebase Authentication.

```sh
firebase login
firebase deploy --only hosting --project PROJECT_ID
```

4. سجّل الدخول من الرابط برقم الإدارة للتحقق من وصول الرسالة. عند نجاحه، راجع طلبات التسجيل وانشر الخدمات الفعلية من لوحة الإدارة.

### المراجع الرسمية

[Firebase Phone Authentication](https://firebase.google.com/docs/auth/web/phone-auth) · [Firebase Hosting with Cloud Run](https://firebase.google.com/docs/hosting/cloud-run) · [Firebase Hosting session cookies](https://firebase.google.com/docs/hosting/manage-cache#using_cookies)
