/* ZENURA IGNITE — central, extensible website language system */
(function(){
  const STORAGE_KEY='zenura-site-language';
  const translations={
    'NEXT-GENERATION DIGITAL STUDIO':'नई पीढ़ी का डिजिटल स्टूडियो',
    'Ideas that':'ऐसे विचार जो','shape the ':'भविष्य को ','future.':'आकार दें।',
    'We design and build powerful digital experiences — from high-performance websites to mobile apps and custom software.':'हम प्रभावशाली डिजिटल अनुभव डिज़ाइन और विकसित करते हैं — आधुनिक वेबसाइटों से लेकर मोबाइल ऐप और कस्टम सॉफ्टवेयर तक।',
    '↗ Start a Project':'↗ प्रोजेक्ट शुरू करें','Explore Services ↓':'सेवाएँ देखें ↓',
    'Digital ideas, engineered with purpose.':'उद्देश्य के साथ तैयार किए गए डिजिटल समाधान।',
    'Modern Design':'आधुनिक डिज़ाइन','Made to stand out':'अलग पहचान बनाने के लिए',
    'Smart Solutions':'स्मार्ट समाधान','Built around your needs':'आपकी ज़रूरतों के अनुसार',
    'Responsive Build':'हर स्क्रीन के लिए','Mobile to desktop':'मोबाइल से डेस्कटॉप तक',
    'Reliable Support':'विश्वसनीय सहायता','Beyond the launch':'लॉन्च के बाद भी',
    'Technology with':'तकनीक में','a spark.':'नई ऊर्जा।',
    'ZENURA IGNITE TECHNOLOGIES turns ambitious ideas into thoughtful digital products. We bring design, technology and purpose together to help businesses move forward.':'ZENURA IGNITE TECHNOLOGIES नए विचारों को उपयोगी डिजिटल उत्पादों में बदलता है। हम डिज़ाइन, तकनीक और उद्देश्य को जोड़कर व्यवसायों को आगे बढ़ने में मदद करते हैं।',
    'Built for the':'तैयार अगला','next step.':'कदम बढ़ाने के लिए।',
    'Digital products that look sharp, work smoothly and help your idea grow.':'ऐसे डिजिटल उत्पाद जो शानदार दिखें, सहजता से काम करें और आपके विचार को आगे बढ़ाएँ।',
    'Website Development':'वेबसाइट विकास','Fast, responsive and memorable websites for your brand.':'आपके ब्रांड के लिए तेज़, उत्तरदायी और यादगार वेबसाइटें।',
    'Mobile App Development':'मोबाइल ऐप विकास','Intuitive mobile experiences for Android and iOS.':'Android और iOS के लिए सरल मोबाइल अनुभव।',
    'Custom Software':'कस्टम सॉफ्टवेयर','Purpose-built tools shaped around your workflow.':'आपके काम के तरीके के अनुसार बनाए गए टूल।',
    'Cloud & Deployment':'क्लाउड और डिप्लॉयमेंट','Secure, scalable deployment for your digital product.':'आपके डिजिटल उत्पाद के लिए सुरक्षित और विस्तार योग्य डिप्लॉयमेंट।',
    'Think boldly.':'बड़ा सोचें।','Build ':'बनाएँ ','brilliantly.':'बेहतरीन।',
    'Clear thinking. Thoughtful design. Technology that works for you.':'स्पष्ट सोच। विचारशील डिज़ाइन। आपके काम आने वाली तकनीक।',
    'Ideas made':'विचारों को','tangible.':'साकार रूप।',
    'Explore the kinds of digital experiences we can create for your business. These are concept showcases, not claimed client projects.':'देखें कि हम आपके व्यवसाय के लिए किस तरह के डिजिटल अनुभव बना सकते हैं। ये केवल कॉन्सेप्ट नमूने हैं, वास्तविक क्लाइंट प्रोजेक्ट नहीं।',
    'E-commerce Experience':'ई-कॉमर्स अनुभव','A clean storefront concept built for product discovery and conversion.':'उत्पाद खोज और बिक्री को ध्यान में रखकर बनाया गया स्टोरफ्रंट कॉन्सेप्ट।',
    'Mobile App Interface':'मोबाइल ऐप इंटरफेस','A focused mobile experience with simple navigation and useful features.':'सरल नेविगेशन और उपयोगी सुविधाओं वाला मोबाइल अनुभव।',
    'Business Dashboard':'बिज़नेस डैशबोर्ड','A responsive dashboard concept for tracking operations and performance.':'कामकाज और प्रदर्शन पर नज़र रखने के लिए उत्तरदायी डैशबोर्ड कॉन्सेप्ट।',
    'Clear scope.':'स्पष्ट कार्य-सीमा।','Right solution.':'सही समाधान।',
    'Every project is different. Choose the starting point that best matches your requirement; we will prepare a tailored quotation after understanding the scope.':'हर प्रोजेक्ट अलग होता है। अपनी ज़रूरत के अनुसार शुरुआती विकल्प चुनें; काम की सीमा समझने के बाद हम आपके लिए प्रस्ताव तैयार करेंगे।',
    'Launch':'शुरुआत','Business':'व्यवसाय','Custom Build':'कस्टम निर्माण',
    'For individuals and small businesses building their first digital presence.':'अपनी पहली डिजिटल पहचान बनाने वाले व्यक्तियों और छोटे व्यवसायों के लिए।',
    'For growing brands that need a richer website and stronger lead generation.':'बढ़ते ब्रांड के लिए जिन्हें बेहतर वेबसाइट और अधिक ग्राहक पूछताछ चाहिए।',
    'For businesses that need apps, portals or software tailored to their workflow.':'ऐसे व्यवसायों के लिए जिन्हें अपने काम के अनुसार ऐप, पोर्टल या सॉफ्टवेयर चाहिए।',
    'Responsive business website':'उत्तरदायी बिज़नेस वेबसाइट','Core pages and contact section':'मुख्य पेज और संपर्क सेक्शन','Basic on-page SEO setup':'बुनियादी ऑन-पेज SEO सेटअप','Deployment assistance':'डिप्लॉयमेंट सहायता',
    'Custom-designed multi-page website':'कस्टम डिज़ाइन वाली बहु-पृष्ठ वेबसाइट','Enquiry and WhatsApp integration':'पूछताछ और WhatsApp एकीकरण','Portfolio or product showcase':'पोर्टफोलियो या उत्पाद प्रदर्शन','Analytics-ready setup':'एनालिटिक्स के लिए तैयार सेटअप',
    'Web app / PWA / mobile app':'वेब ऐप / PWA / मोबाइल ऐप','Custom features and integrations':'कस्टम सुविधाएँ और एकीकरण','Backend and database planning':'बैकएंड और डेटाबेस योजना','Ongoing support options':'निरंतर सहायता विकल्प',
    'Request a quote ↗':'कोटेशन माँगें ↗','Discuss this package ↗':'इस पैकेज पर चर्चा करें ↗','Plan a solution ↗':'समाधान की योजना बनाएँ ↗',
    'Pricing is provided after requirement review. No fixed prices are published until scope, features and delivery needs are confirmed.':'ज़रूरतों की समीक्षा के बाद कीमत बताई जाएगी। काम, सुविधाएँ और डिलीवरी तय होने तक कोई निश्चित कीमत प्रकाशित नहीं की गई है।',
    "Your idea.":'आपका विचार।','Our next project.':'हमारा अगला प्रोजेक्ट।',"Tell us what you have in mind. Let's make it real.":'आप क्या बनवाना चाहते हैं, हमें बताएँ। आइए उसे साकार करें।',
    'Your name':'आपका नाम','Email or phone':'ईमेल या फ़ोन','Project details':'प्रोजेक्ट का विवरण','Name':'नाम','Tell us about your idea...':'अपने विचार के बारे में बताएँ...','Prepare Enquiry ↗':'पूछताछ तैयार करें ↗',
    'Contact form currently prepares an email draft. Confirm your official business email before launch.':'संपर्क फ़ॉर्म अभी ईमेल ड्राफ्ट तैयार करता है। लॉन्च से पहले आधिकारिक बिज़नेस ईमेल की पुष्टि करें।',
    'Igniting innovation. Building the future.':'नवाचार को ऊर्जा देना। भविष्य का निर्माण करना।','BACK TO TOP ↑':'ऊपर जाएँ ↑'
  };
  const attrMap={'placeholder':{'Name':'नाम','you@example.com':'आपका ईमेल या फ़ोन','Tell us about your idea...':'अपने विचार के बारे में बताएँ...'}};
  function lang(){return localStorage.getItem(STORAGE_KEY)==='hi'?'hi':'en'}
  function translateNode(node,language){
    if(node.nodeType===Node.TEXT_NODE){const raw=node.nodeValue,trim=raw.trim();if(translations[trim])node.nodeValue=raw.replace(trim,language==='hi'?translations[trim]:node.parentElement?.dataset?.originalText||trim);return;}
    if(node.nodeType!==Node.ELEMENT_NODE)return;
    if(node.matches('script,style, noscript, textarea'))return;
    if(node.hasAttribute('data-i18n')){const key=node.getAttribute('data-i18n');if(!node.dataset.i18nOriginal)node.dataset.i18nOriginal=node.textContent;node.textContent=language==='hi'?(translations[key]||key):node.dataset.i18nOriginal;}
    if(node.hasAttribute('data-en'))node.textContent=language==='hi'?(node.dataset.hi||node.dataset.en):node.dataset.en;
    if(node.hasAttribute('data-en-html'))node.innerHTML=language==='hi'?(node.dataset.hiHtml||node.dataset.enHtml):node.dataset.enHtml;
    for(const [attr,dict] of Object.entries(attrMap)){if(node.hasAttribute(attr)){const original=node.getAttribute('data-original-'+attr)||node.getAttribute(attr);node.setAttribute('data-original-'+attr,original);if(language==='hi'&&dict[original])node.setAttribute(attr,dict[original]);else node.setAttribute(attr,original);}}
    if(!node.matches('[data-i18n],[data-en],[data-en-html]'))for(const child of [...node.childNodes])translateNode(child,language);
  }
  function apply(language){
    document.documentElement.lang=language;
    translateNode(document.body,language);
    const button=document.getElementById('language-toggle');
    if(button){button.querySelector('.language-label').textContent=language==='en'?'हिंदी':'English';button.setAttribute('aria-pressed',String(language==='hi'));button.setAttribute('aria-label',language==='en'?'Switch website to Hindi':'Switch website to English');}
  }
  window.ZenuraI18n={getLanguage:lang,setLanguage:apply,register:function(entries){Object.assign(translations,entries);apply(lang());}};
  document.addEventListener('DOMContentLoaded',()=>{
    const initial=lang();apply(initial);
    document.getElementById('language-toggle')?.addEventListener('click',()=>{const next=lang()==='en'?'hi':'en';localStorage.setItem(STORAGE_KEY,next);apply(next);});
    const observer=new MutationObserver(records=>{for(const record of records)for(const node of record.addedNodes)translateNode(node,lang());});
    observer.observe(document.body,{childList:true,subtree:true});
  });
})();