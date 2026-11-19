/* ZENURA IGNITE — central, extensible website language system */
(function () {
  'use strict';
  const STORAGE_KEY = 'zenura-site-language-v2';
  const translations = {
    'Home':'होम','About':'परिचय','Services':'सेवाएँ','Our Approach':'हमारा तरीका','Portfolio':'पोर्टफोलियो','Pricing':'कीमत','Contact':'संपर्क',
    'NEXT-GENERATION DIGITAL STUDIO':'नई पीढ़ी का डिजिटल स्टूडियो',
    'Ideas that':'ऐसे विचार जो','shape the':'भविष्य को','future.':'आकार दें।',
    'We design and build powerful digital experiences — from high-performance websites to mobile apps and custom software.':'हम प्रभावशाली डिजिटल अनुभव डिज़ाइन और विकसित करते हैं — आधुनिक वेबसाइटों से लेकर मोबाइल ऐप और कस्टम सॉफ्टवेयर तक।',
    '↗ Start a Project':'↗ प्रोजेक्ट शुरू करें','Explore Services ↓':'सेवाएँ देखें ↓',
    'Digital ideas, engineered with purpose.':'उद्देश्य के साथ तैयार किए गए डिजिटल समाधान।',
    'Modern Design':'आधुनिक डिज़ाइन','Made to stand out':'अलग पहचान बनाने के लिए','Smart Solutions':'स्मार्ट समाधान','Built around your needs':'आपकी ज़रूरतों के अनुसार',
    'Responsive Build':'हर स्क्रीन के लिए','Mobile to desktop':'मोबाइल से डेस्कटॉप तक','Reliable Support':'विश्वसनीय सहायता','Beyond the launch':'लॉन्च के बाद भी',
    '01 / THE ZENURA VISION':'01 / ज़ेनुरा का विज़न','02 / WHAT WE DO':'02 / हमारी सेवाएँ','03 / OUR APPROACH':'03 / हमारा तरीका',
    '04 / PORTFOLIO':'04 / पोर्टफोलियो','05 / SIMPLE ENGAGEMENT':'05 / आसान शुरुआत','04 / LET\'S BUILD SOMETHING':'06 / आइए कुछ नया बनाएँ',
    'Technology with':'तकनीक में','a spark.':'नई ऊर्जा।',
    'ZENURA IGNITE TECHNOLOGIES turns ambitious ideas into thoughtful digital products. We bring design, technology and purpose together to help businesses move forward.':'ZENURA IGNITE TECHNOLOGIES नए विचारों को उपयोगी डिजिटल उत्पादों में बदलता है। हम डिज़ाइन, तकनीक और उद्देश्य को जोड़कर व्यवसायों को आगे बढ़ने में मदद करते हैं।',
    'Built for the':'अगले कदम के लिए','next step.':'तैयार।','Digital products that look sharp, work smoothly and help your idea grow.':'ऐसे डिजिटल उत्पाद जो शानदार दिखें, सहजता से काम करें और आपके विचार को आगे बढ़ाएँ।',
    'Website Development':'वेबसाइट विकास','Fast, responsive and memorable websites for your brand.':'आपके ब्रांड के लिए तेज़, उत्तरदायी और यादगार वेबसाइटें।',
    'Mobile App Development':'मोबाइल ऐप विकास','Intuitive mobile experiences for Android and iOS.':'Android और iOS के लिए सरल मोबाइल अनुभव।',
    'Custom Software':'कस्टम सॉफ्टवेयर','Purpose-built tools shaped around your workflow.':'आपके काम के तरीके के अनुसार बनाए गए टूल।',
    'Cloud & Deployment':'क्लाउड और डिप्लॉयमेंट','Secure, scalable deployment for your digital product.':'आपके डिजिटल उत्पाद के लिए सुरक्षित और विस्तार योग्य डिप्लॉयमेंट।',
    'Think boldly.':'बड़ा सोचें।','Build':'बनाएँ','brilliantly.':'बेहतरीन।','Clear thinking. Thoughtful design. Technology that works for you.':'स्पष्ट सोच। विचारशील डिज़ाइन। आपके काम आने वाली तकनीक।',
    'Ideas made':'विचारों को','tangible.':'साकार रूप।',
    'Explore the kinds of digital experiences we can create for your business. These are concept showcases, not claimed client projects.':'देखें कि हम आपके व्यवसाय के लिए किस तरह के डिजिटल अनुभव बना सकते हैं। ये केवल कॉन्सेप्ट नमूने हैं, वास्तविक क्लाइंट प्रोजेक्ट नहीं।',
    'YOUR BRAND':'आपका ब्रांड','Commerce':'व्यापार','reimagined.':'नए अंदाज़ में।','SHOP • DISCOVER • GROW':'खरीदें • खोजें • आगे बढ़ें',
    'ZENURA APP':'ज़ेनुरा ऐप','Everything':'सब कुछ','in one place.':'एक ही जगह।','INSIGHT / 01':'जानकारी / 01','Make data':'डेटा को','work for you.':'अपने काम में लाएँ।',
    '01 / CONCEPT SHOWCASE':'01 / कॉन्सेप्ट नमूना','02 / CONCEPT SHOWCASE':'02 / कॉन्सेप्ट नमूना','03 / CONCEPT SHOWCASE':'03 / कॉन्सेप्ट नमूना',
    'E-commerce Experience':'ई-कॉमर्स अनुभव','A clean storefront concept built for product discovery and conversion.':'उत्पाद खोज और बिक्री को ध्यान में रखकर बनाया गया स्टोरफ्रंट कॉन्सेप्ट।',
    'Mobile App Interface':'मोबाइल ऐप इंटरफेस','A focused mobile experience with simple navigation and useful features.':'सरल नेविगेशन और उपयोगी सुविधाओं वाला मोबाइल अनुभव।',
    'Business Dashboard':'बिज़नेस डैशबोर्ड','A responsive dashboard concept for tracking operations and performance.':'कामकाज और प्रदर्शन पर नज़र रखने के लिए उत्तरदायी डैशबोर्ड कॉन्सेप्ट।',
    'Clear scope.':'स्पष्ट कार्य-सीमा।','Right solution.':'सही समाधान।',
    'Every project is different. Choose the starting point that best matches your requirement; we will prepare a tailored quotation after understanding the scope.':'हर प्रोजेक्ट अलग होता है। अपनी ज़रूरत के अनुसार शुरुआती विकल्प चुनें; काम की सीमा समझने के बाद हम आपके लिए प्रस्ताव तैयार करेंगे।',
    '01 / STARTER':'01 / शुरुआती','02 / GROWTH':'02 / विकास','03 / ADVANCED':'03 / उन्नत',
    'Launch':'शुरुआत','Business':'व्यवसाय','Custom Build':'कस्टम निर्माण',
    'For individuals and small businesses building their first digital presence.':'अपनी पहली डिजिटल पहचान बनाने वाले व्यक्तियों और छोटे व्यवसायों के लिए।',
    'For growing brands that need a richer website and stronger lead generation.':'बढ़ते ब्रांड के लिए जिन्हें बेहतर वेबसाइट और अधिक ग्राहक पूछताछ चाहिए।',
    'For businesses that need apps, portals or software tailored to their workflow.':'ऐसे व्यवसायों के लिए जिन्हें अपने काम के अनुसार ऐप, पोर्टल या सॉफ्टवेयर चाहिए।',
    'Responsive business website':'उत्तरदायी बिज़नेस वेबसाइट','Core pages and contact section':'मुख्य पेज और संपर्क सेक्शन','Basic on-page SEO setup':'बुनियादी ऑन-पेज SEO सेटअप','Deployment assistance':'डिप्लॉयमेंट सहायता',
    'Custom-designed multi-page website':'कस्टम डिज़ाइन वाली बहु-पृष्ठ वेबसाइट','Enquiry and WhatsApp integration':'पूछताछ और WhatsApp एकीकरण','Portfolio or product showcase':'पोर्टफोलियो या उत्पाद प्रदर्शन','Analytics-ready setup':'एनालिटिक्स के लिए तैयार सेटअप',
    'Web app / PWA / mobile app':'वेब ऐप / PWA / मोबाइल ऐप','Custom features and integrations':'कस्टम सुविधाएँ और एकीकरण','Backend and database planning':'बैकएंड और डेटाबेस योजना','Ongoing support options':'निरंतर सहायता विकल्प',
    'Request a quote ↗':'कोटेशन माँगें ↗','Discuss this package ↗':'इस पैकेज पर चर्चा करें ↗','Plan a solution ↗':'समाधान की योजना बनाएँ ↗',
    'Pricing is provided after requirement review. No fixed prices are published until scope, features and delivery needs are confirmed.':'ज़रूरतों की समीक्षा के बाद कीमत बताई जाएगी। काम, सुविधाएँ और डिलीवरी तय होने तक कोई निश्चित कीमत प्रकाशित नहीं की गई है।',
    'Your idea.':'आपका विचार।','Our next project.':'हमारा अगला प्रोजेक्ट।','Tell us what you have in mind. Let\'s make it real.':'आप क्या बनवाना चाहते हैं, हमें बताएँ। आइए उसे साकार करें।',
    'Your name':'आपका नाम','Email or phone':'ईमेल या फ़ोन','Project details':'प्रोजेक्ट का विवरण','Name':'नाम','Tell us about your idea...':'अपने विचार के बारे में बताएँ...','Prepare Enquiry ↗':'पूछताछ तैयार करें ↗',
    'Contact form currently prepares an email draft. Confirm your official business email before launch.':'संपर्क फ़ॉर्म अभी ईमेल ड्राफ्ट तैयार करता है। लॉन्च से पहले आधिकारिक बिज़नेस ईमेल की पुष्टि करें।',
    'Igniting innovation. Building the future.':'नवाचार को ऊर्जा देना। भविष्य का निर्माण करना।','Designed & Developed by':'डिज़ाइन और विकास','BACK TO TOP ↑':'ऊपर जाएँ ↑'
  };

  Object.assign(translations, {
    'Medicine shop and pharmacy':'दवा दुकान और मेडिकल स्टोर',
    'Grocery stores, bookstores and small malls':'किराना, बुकस्टोर और छोटे मॉल',
    'Car/bike garages and service centres':'कार/बाइक गैराज और सर्विस सेंटर',
    'Coaching institutes and schools up to Class 12':'कोचिंग संस्थान और कक्षा 10वीं–12वीं तक के स्कूल',
    'A simple digital solution for medicine lists, customer information and everyday store operations.':'दवा सूची, ग्राहक जानकारी और रोज़मर्रा के स्टोर संचालन के लिए सरल डिजिटल समाधान।',
    'A simple solution for local grocery stores to display products and receive order enquiries.':'स्थानीय किराना दुकान के लिए उत्पाद सूची और ऑर्डर enquiry वाला सरल समाधान।',
    'A website to showcase books, stationery and educational materials.':'किताबों, स्टेशनरी और शैक्षणिक सामग्री की सूची दिखाने के लिए वेबसाइट।',
    'A digital directory for a small mall or multiple stores in one location.':'छोटे मॉल या एक ही स्थान पर कई दुकानों की डिजिटल डायरेक्टरी।',
    'A solution for local garages with service listings, enquiries and appointment requests.':'स्थानीय गैराज के लिए सर्विस सूची, enquiry और appointment request वाला समाधान।',
    'For coaching centres to present courses, batches, faculty and admission enquiries.':'कोचिंग सेंटर के courses, batches, faculty और admission enquiries के लिए।',
    'A website for small and medium schools to share classes, facilities, notices and admission information.':'छोटे/मध्यम स्कूल के लिए कक्षाओं, सुविधाओं, सूचनाओं और प्रवेश जानकारी की वेबसाइट।',
    'Mobile-friendly website':'मोबाइल-अनुकूल वेबसाइट',
    'Medicine and product catalogue':'दवा और उत्पाद सूची',
    'Store address and contact details':'दुकान का पता व संपर्क',
    'WhatsApp enquiry button':'WhatsApp enquiry बटन',
    'All Silver features':'Silver की सभी सुविधाएँ',
    'Stock and expiry tracking module':'स्टॉक और एक्सपायरी रिकॉर्ड मॉड्यूल',
    'Basic billing records':'बेसिक बिलिंग रिकॉर्ड',
    'Customer enquiry management':'ग्राहक enquiry प्रबंधन',
    'Store information and opening hours':'दुकान की जानकारी और समय',
    'Product categories and catalogue':'उत्पाद श्रेणियाँ व सूची',
    'WhatsApp order enquiries':'WhatsApp पर ऑर्डर enquiry',
    'Mobile-friendly design':'मोबाइल-अनुकूल डिज़ाइन',
    'Indicative project price':'Indicative project price',
    'All sectors':'सभी क्षेत्र',
    'View features & plan details ↗':'सुविधाएँ और प्लान देखें ↗',
    'Request this solution ↗':'यह समाधान चुनें ↗',
    'Medicine and product list':'दवा और उत्पाद सूची',
    'Shop address and contact':'दुकान का पता व संपर्क',
    'Stock and expiry records module':'स्टॉक और एक्सपायरी रिकॉर्ड मॉड्यूल',
    'Basic billing records':'बेसिक बिलिंग रिकॉर्ड',
    'Customer enquiry management':'ग्राहक enquiry प्रबंधन',
    'Shop information and opening hours':'दुकान की जानकारी और समय',
    'Product categories and list':'उत्पाद श्रेणियाँ व सूची',
    'Mobile-friendly design':'मोबाइल-अनुकूल डिज़ाइन',
    'Books and stationery catalogue':'Books और stationery catalogue',
    'Categories by subject/class':'विषय/कक्षा के अनुसार श्रेणियाँ',
    'Availability enquiry':'उपलब्धता enquiry',
    'Shop contact and location':'दुकान संपर्क व लोकेशन',
    'Author/publisher/class filters':'लेखक/प्रकाशक/कक्षा फ़िल्टर',
    'New arrivals and offers':'नई arrivals और offers',
    'WhatsApp order enquiry':'WhatsApp order enquiry',
    'Mall introduction and location':'Mall परिचय और लोकेशन',
    'List of shops':'दुकानों की सूची',
    'Shop-wise contact details':'दुकान-वार संपर्क विवरण',
    'Mobile-friendly page':'मोबाइल-अनुकूल पेज',
    'Shop categories and search':'दुकान श्रेणी और खोज',
    'Individual shop detail page':'प्रत्येक दुकान का विवरण पेज',
    'Offers and announcements section':'ऑफर और सूचना सेक्शन',
    'Service and repair list':'सर्विस और repair सूची',
    'Garage address and hours':'गैराज का पता व समय',
    'Call and WhatsApp buttons':'Call और WhatsApp बटन',
    'Appointment request form':'Appointment request form',
    'Vehicle service packages':'Vehicle service packages',
    'Appointment request dashboard':'Appointment request dashboard',
    'Customer and vehicle enquiry record':'Customer और vehicle enquiry record',
    'Gallery and customer reviews':'Gallery और customer reviews',
    'Course and subject information':'Courses और subjects की जानकारी',
    'Faculty introduction':'Faculty परिचय',
    'Batch timings and fee information':'Batch timing और fees जानकारी',
    'Admission enquiry form':'Admission enquiry form',
    'Online notices and updates section':'Online notice और updates section',
    'Student enquiry management':'Student enquiry management',
    'Study material download section':'Study material download section',
    'School introduction and facilities':'School परिचय और सुविधाएँ',
    'Class 1–12 information':'कक्षा 1–12 तक की जानकारी',
    'Admission and contact section':'Admission और contact section',
    'Photo gallery and notices':'Photo gallery और notices',
    'Class-wise notice section':'Class-wise notice section',
    'Downloadable forms/documents':'Downloadable forms/documents',
    'Events and academic calendar':'Events और academic calendar',
    'Admin notice/content editor':'Admin notice/content editor',
    'Indicative pricing only. Final quotation depends on scope, content, hosting and custom requirements.':'केवल अनुमानित कीमत। अंतिम प्रस्ताव काम, सामग्री, होस्टिंग और विशेष आवश्यकताओं पर निर्भर करेगा।',
    'All sectors':'सभी क्षेत्र',
    'View features & plan details ↗':'सुविधाएँ और प्लान देखें ↗',
    'Request this solution ↗':'यह समाधान चुनें ↗',
    'Close ✕':'बंद करें ✕'
  });
  Object.assign(translations, {
    'Medical & Pharmacy':'दवा दुकान और मेडिकल स्टोर',
    'Shops & Retail':'किराना, बुकस्टोर और छोटे मॉल',
    'Automobile & Garage':'कार/बाइक गैराज और सर्विस सेंटर',
    'Education & Learning':'कोचिंग संस्थान और कक्षा 10वीं–12वीं तक के स्कूल',
    'दवा सूची, ग्राहक जानकारी और रोज़मर्रा के स्टोर संचालन के लिए सरल डिजिटल समाधान।':'A simple digital solution for medicine lists, customer information and everyday store operations.',
    'स्थानीय किराना दुकान के लिए उत्पाद सूची और ऑर्डर enquiry वाला सरल समाधान।':'A simple solution for local grocery stores to display products and receive order enquiries.',
    'किताबों, स्टेशनरी और शैक्षणिक सामग्री की सूची दिखाने के लिए वेबसाइट।':'A website to showcase books, stationery and educational materials.',
    'छोटे मॉल या एक ही स्थान पर कई दुकानों की डिजिटल डायरेक्टरी।':'A digital directory for a small mall or multiple stores in one location.',
    'स्थानीय गैराज के लिए सर्विस सूची, enquiry और appointment request वाला समाधान।':'A solution for local garages with service listings, enquiries and appointment requests.',
    'कोचिंग सेंटर के courses, batches, faculty और admission enquiries के लिए।':'For coaching centres to present courses, batches, faculty and admission enquiries.',
    'छोटे/मध्यम स्कूल के लिए कक्षाओं, सुविधाओं, सूचनाओं और प्रवेश जानकारी की वेबसाइट।':'A website for small and medium schools to share classes, facilities, notices and admission information.',
    'मोबाइल-अनुकूल वेबसाइट':'Mobile-friendly website',
    'दवा और उत्पाद सूची':'Medicine and product catalogue',
    'दुकान का पता व संपर्क':'Store address and contact details',
    'WhatsApp enquiry बटन':'WhatsApp enquiry button',
    'Silver की सभी सुविधाएँ':'All Silver features',
    'स्टॉक और एक्सपायरी रिकॉर्ड मॉड्यूल':'Stock and expiry tracking module',
    'बेसिक बिलिंग रिकॉर्ड':'Basic billing records',
    'ग्राहक enquiry प्रबंधन':'Customer enquiry management',
    'दुकान की जानकारी और समय':'Store information and opening hours',
    'उत्पाद श्रेणियाँ व सूची':'Product categories and catalogue',
    'WhatsApp पर ऑर्डर enquiry':'WhatsApp order enquiries',
    'मोबाइल-अनुकूल डिज़ाइन':'Mobile-friendly design',
    'Books और stationery catalogue':'Books and stationery catalogue',
    'विषय/कक्षा के अनुसार श्रेणियाँ':'Categories by subject/class',
    'उपलब्धता enquiry':'Availability enquiry',
    'दुकान संपर्क व लोकेशन':'Shop contact and location',
    'लेखक/प्रकाशक/कक्षा फ़िल्टर':'Author/publisher/class filters',
    'नई arrivals और offers':'New arrivals and offers',
    'WhatsApp order enquiry':'WhatsApp order enquiry',
    'Mall परिचय और लोकेशन':'Mall introduction and location',
    'दुकानों की सूची':'List of shops',
    'दुकान-वार संपर्क विवरण':'Shop-wise contact details',
    'मोबाइल-अनुकूल पेज':'Mobile-friendly page',
    'दुकान श्रेणी और खोज':'Shop categories and search',
    'प्रत्येक दुकान का विवरण पेज':'Individual shop detail page',
    'ऑफर और सूचना सेक्शन':'Offers and announcements section',
    'सर्विस और repair सूची':'Service and repair list',
    'गैराज का पता व समय':'Garage address and hours',
    'Call और WhatsApp बटन':'Call and WhatsApp buttons',
    'Appointment request form':'Appointment request form',
    'Vehicle service packages':'Vehicle service packages',
    'Appointment request dashboard':'Appointment request dashboard',
    'Customer और vehicle enquiry record':'Customer and vehicle enquiry record',
    'Gallery और customer reviews':'Gallery and customer reviews',
    'Courses और subjects की जानकारी':'Course and subject information',
    'Faculty परिचय':'Faculty introduction',
    'Batch timing और fees जानकारी':'Batch timings and fee information',
    'Admission enquiry form':'Admission enquiry form',
    'Online notice और updates section':'Online notices and updates section',
    'Student enquiry management':'Student enquiry management',
    'Study material download section':'Study material download section',
    'School परिचय और सुविधाएँ':'School introduction and facilities',
    'कक्षा 1–12 तक की जानकारी':'Class 1–12 information',
    'Admission और contact section':'Admission and contact section',
    'Photo gallery और notices':'Photo gallery and notices',
    'Class-wise notice section':'Class-wise notice section',
    'Downloadable forms/documents':'Downloadable forms/documents',
    'Events और academic calendar':'Events and academic calendar',
    'Admin notice/content editor':'Admin notice/content editor',
    'केवल अनुमानित कीमत। अंतिम प्रस्ताव काम, सामग्री, होस्टिंग और विशेष आवश्यकताओं पर निर्भर करेगा।':'Indicative pricing only. Final quotation depends on scope, content, hosting and custom requirements.'
  });
  const originalText = new WeakMap();
  const originalHtml = new WeakMap();
  const originalAttributes = new WeakMap();
  const attributeTranslations = {
    placeholder: {'Name':'नाम','you@example.com':'आपका ईमेल या फ़ोन','Tell us about your idea...':'अपने विचार के बारे में बताएँ...'},
    'aria-label': {'Menu':'मेन्यू','Switch website language':'वेबसाइट की भाषा बदलें'},
    title: {}
  };

  function getLanguage() {
    try { return localStorage.getItem(STORAGE_KEY) === 'hi' ? 'hi' : 'en'; }
    catch (_) { return 'en'; }
  }

  function translateElement(element, language) {
    if (element.nodeType === Node.TEXT_NODE) {
      if (!originalText.has(element)) originalText.set(element, element.nodeValue);
      const source = originalText.get(element);
      const key = source.trim();
      const englishKey = Object.prototype.hasOwnProperty.call(translations, key)
        ? key : Object.keys(translations).find(k => translations[k] === key);
      if (englishKey) {
        const translated = language === 'hi' ? translations[englishKey] : englishKey;
        element.nodeValue = source.replace(key, translated);
      }
      return;
    }
    if (element.nodeType !== Node.ELEMENT_NODE) return;
    if (element.matches('script,style,noscript,textarea')) return;

    if (element.hasAttribute('data-i18n')) {
      if (!originalHtml.has(element)) originalHtml.set(element, element.innerHTML);
      const key = element.getAttribute('data-i18n');
      element.textContent = language === 'hi' ? (translations[key] || key) : originalHtml.get(element);
      return;
    }
    if (element.hasAttribute('data-en-html')) {
      if (!originalHtml.has(element)) originalHtml.set(element, element.innerHTML);
      element.innerHTML = language === 'hi'
        ? (element.getAttribute('data-hi-html') || element.getAttribute('data-en-html'))
        : element.getAttribute('data-en-html');
      return;
    }
    if (element.hasAttribute('data-en')) {
      if (!originalHtml.has(element)) originalHtml.set(element, element.innerHTML);
      element.textContent = language === 'hi'
        ? (element.getAttribute('data-hi') || element.getAttribute('data-en'))
        : element.getAttribute('data-en');
      return;
    }

    for (const [attribute, dictionary] of Object.entries(attributeTranslations)) {
      if (!element.hasAttribute(attribute)) continue;
      if (!originalAttributes.has(element)) originalAttributes.set(element, {});
      const saved = originalAttributes.get(element);
      if (!(attribute in saved)) saved[attribute] = element.getAttribute(attribute);
      const original = saved[attribute];
      element.setAttribute(attribute, language === 'hi' ? (dictionary[original] || original) : original);
    }
    for (const child of Array.from(element.childNodes)) translateElement(child, language);
  }

  function applyLanguage(language) {
    const safeLanguage = language === 'hi' ? 'hi' : 'en';
    document.documentElement.lang = safeLanguage;
    translateElement(document.body, safeLanguage);
    const button = document.getElementById('language-toggle');
    if (button) {
      const label = button.querySelector('.language-label');
      if (label) label.textContent = safeLanguage === 'en' ? 'हिंदी' : 'English';
      button.setAttribute('aria-pressed', String(safeLanguage === 'hi'));
      button.setAttribute('aria-label', safeLanguage === 'en' ? 'Switch website to Hindi' : 'Switch website to English');
    }
  }

  window.ZenuraI18n = {
    getLanguage,
    setLanguage: function (language) {
      try { localStorage.setItem(STORAGE_KEY, language === 'hi' ? 'hi' : 'en'); } catch (_) {}
      applyLanguage(language);
    },
    register: function (entries) {
      if (!entries || typeof entries !== 'object' || Array.isArray(entries)) return;
      Object.assign(translations, entries);
      applyLanguage(getLanguage());
    }
  };

  function initialise() {
    applyLanguage(getLanguage());
    const button = document.getElementById('language-toggle');
    if (button) button.addEventListener('click', function () {
      window.ZenuraI18n.setLanguage(getLanguage() === 'en' ? 'hi' : 'en');
    });
    const observer = new MutationObserver(function (records) {
      for (const record of records) {
        for (const node of record.addedNodes) translateElement(node, getLanguage());
      }
    });
    observer.observe(document.body, {childList:true, subtree:true});
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initialise, {once:true});
  else initialise();
})();