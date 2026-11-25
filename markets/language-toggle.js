(function(){
  "use strict";
  const KEY="zenura-language-v1";
  const HI=Object.freeze({
    "ZENURA IGNITE · Indian Stock Market":"ZENURA IGNITE · भारतीय शेयर बाजार",
    "Paper Trading":"पेपर ट्रेडिंग",
    "PAPER TRADING":"पेपर ट्रेडिंग",
    "← ALL MARKETS":"← सभी मार्केट","INDIAN STOCK MARKET":"भारतीय शेयर बाजार",
    "NSE · BSE · DERIVATIVES":"NSE · BSE · डेरिवेटिव्स",
    "Indian Market":"भारतीय बाजार","Terminal":"टर्मिनल",
    "Independent paper-trading workspace. Crypto balances, positions and history are not shared here.":"अलग पेपर ट्रेडिंग वर्कस्पेस। क्रिप्टो बैलेंस, होल्डिंग और इतिहास यहाँ साझा नहीं होते।",
    "DATA FEED NOT CONNECTED":"डेटा फीड कनेक्ट नहीं है",
    "Sign in, then authorize your Upstox account":"साइन इन करें और Upstox खाते को अधिकृत करें",
    "SIGN IN / CONNECT":"साइन इन / कनेक्ट","DISCONNECT UPSTOX":"UPSTOX डिस्कनेक्ट करें",
    "Live data setup required":"लाइव डेटा सेटअप आवश्यक",
    "This workspace will not display invented or delayed prices as live. Upstox OAuth credentials and account authorization must be configured securely on the server before real-time quotes and order simulation can be enabled.":"यह वर्कस्पेस नकली या देरी वाले भाव को लाइव नहीं दिखाएगा। रियल-टाइम भाव और ऑर्डर सिमुलेशन शुरू करने से पहले सर्वर पर Upstox OAuth क्रेडेंशियल और खाते का सुरक्षित प्राधिकरण आवश्यक है।",
    "Upstox API docs ↗":"Upstox API दस्तावेज़ ↗",
    "MARKET WATCH":"मार्केट वॉच","Watchlists":"वॉचलिस्ट","Indices":"सूचकांक","Equities":"शेयर","Futures":"फ्यूचर्स","Options":"ऑप्शंस",
    "Search symbol / instrument":"सिंबल / इंस्ट्रूमेंट खोजें","Instrument list will load from the authorized Upstox instrument master.":"अधिकृत Upstox इंस्ट्रूमेंट सूची से शेयर लोड होंगे।",
    "MY WATCHLIST":"मेरी वॉचलिस्ट","REFRESH PRICES":"भाव रिफ्रेश करें","+ ADD SELECTED":"+ चुना हुआ जोड़ें",
    "SAVED LIST":"सेव की गई सूची","Sign in to save instruments to your account.":"इंस्ट्रूमेंट सेव करने के लिए साइन इन करें।",
    "Your saved instruments will appear here.":"आपके सेव किए गए इंस्ट्रूमेंट यहाँ दिखेंगे।",
    "SELECTED INSTRUMENT":"चुना गया इंस्ट्रूमेंट","No instrument selected":"कोई इंस्ट्रूमेंट नहीं चुना गया",
    "Connect data feed to load market instruments":"मार्केट इंस्ट्रूमेंट लोड करने के लिए डेटा फीड कनेक्ट करें",
    "Market chart awaits data connection":"मार्केट चार्ट डेटा कनेक्शन की प्रतीक्षा में है",
    "Historical candles load from Upstox after sign-in and account authorization.":"साइन इन और खाते के प्राधिकरण के बाद Upstox से ऐतिहासिक कैंडल लोड होंगे।",
    "Professional chart · Upstox V3":"प्रोफेशनल चार्ट · Upstox V3",
    "Chart":"चार्ट","Candlestick":"कैंडलस्टिक","OHLC Bars":"OHLC बार","Area":"एरिया","Line":"लाइन",
    "Moving Average (MA)":"मूविंग एवरेज (MA)","Exponential MA (EMA)":"एक्सपोनेंशियल MA (EMA)","Simple MA (SMA)":"सिंपल MA (SMA)",
    "Bollinger Bands":"बोलिंजर बैंड","Bull and Bear Index (BBI)":"बुल एंड बेयर इंडेक्स (BBI)","Bias Ratio (BIAS)":"बायस रेशियो (BIAS)",
    "BR / AR":"BR / AR","CR Indicator":"CR इंडिकेटर","Dual MA (DMA)":"डुअल MA (DMA)","Psychological Line (PSY)":"साइकोलॉजिकल लाइन (PSY)",
    "Awesome Oscillator (AO)":"ऑसम ऑसिलेटर (AO)","Momentum (MTM)":"मोमेंटम (MTM)","Volume Ratio (VR)":"वॉल्यूम रेशियो (VR)",
    "Money Flow Index":"मनी फ्लो इंडेक्स","Rate of Change":"रेट ऑफ चेंज","Price Volume Trend":"प्राइस वॉल्यूम ट्रेंड",
    "ADD INDICATOR":"इंडिकेटर जोड़ें","REMOVE SELECTED":"चुना इंडिकेटर हटाएँ","REMOVE SELECTED":"चुना इंडिकेटर हटाएँ","Trendline":"ट्रेंडलाइन","Horizontal":"क्षैतिज","Vertical":"लंबवत","Ray":"रे",
    "Channel":"चैनल","Fibonacci":"फिबोनाची","Fib Ext.":"फिबोनाची एक्सटेंशन","Rectangle":"आयत","Circle":"वृत्त","Arrow":"तीर","Text":"टेक्स्ट","Brush":"ब्रश","Measure":"मापें",
    "Chart template name":"चार्ट टेम्पलेट का नाम","SAVE TEMPLATE":"टेम्पलेट सेव करें","Saved templates":"सेव टेम्पलेट","LOAD":"लोड करें",
    "UNDO":"पूर्ववत","REDO":"फिर से करें","DELETE LAST":"आखिरी हटाएँ",
    "PAPER ORDER":"पेपर ऑर्डर","Order Ticket":"ऑर्डर टिकट","Product mode":"प्रोडक्ट मोड","Delivery":"डिलीवरी","Intraday":"इंट्राडे",
    "MARKET":"मार्केट","LIMIT":"लिमिट","Reference / live price":"संदर्भ / लाइव भाव","Waiting for verified quote":"सत्यापित भाव की प्रतीक्षा",
    "Limit price (₹)":"लिमिट भाव (₹)","Enter limit price":"लिमिट भाव दर्ज करें","Estimated order value":"अनुमानित ऑर्डर मूल्य",
    "VIRTUAL CASH":"वर्चुअल कैश","Sign in and connect Upstox to initialize your separate Indian-market account.":"अलग भारतीय मार्केट खाते को शुरू करने के लिए साइन इन करें और Upstox कनेक्ट करें।",
    "Quantity":"मात्रा","BUY":"खरीदें","SELL":"बेचें","REALIZED P&L":"वास्तविक लाभ/हानि",
    "Simulation only. Market orders for NSE/BSE cash equities; no broker order is submitted.":"केवल सिमुलेशन। NSE/BSE कैश शेयरों के लिए मार्केट ऑर्डर; ब्रोकर को वास्तविक ऑर्डर नहीं भेजा जाता।",
    "PRIVATE PAPER ACCOUNT":"निजी पेपर खाता","Pending & Order Book":"लंबित ऑर्डर और ऑर्डर बुक","Refresh orders":"ऑर्डर रिफ्रेश करें",
    "Available Cash":"उपलब्ध नकद","Reserved Cash":"आरक्षित नकद","Available Shares":"उपलब्ध शेयर","Reserved Shares":"आरक्षित शेयर",
    "Sign in to load your private paper orders.":"निजी पेपर ऑर्डर लोड करने के लिए साइन इन करें।",
    "ALL":"सभी","OPEN / PENDING":"खुले / लंबित","FILLED":"पूरे हुए","CANCELLED":"रद्द",
    "DATE & TIME":"दिनांक और समय","ORDER":"ऑर्डर","PRODUCT":"प्रोडक्ट","SIDE":"साइड","TYPE":"प्रकार","QTY":"मात्रा",
    "LIMIT PRICE":"लिमिट भाव","EXECUTION PRICE":"एक्जीक्यूशन भाव","STATUS":"स्थिति","ACTION":"कार्रवाई",
    "Sign in to view private orders.":"निजी ऑर्डर देखने के लिए साइन इन करें।","Load older orders":"पुराने ऑर्डर लोड करें",
    "EXECUTED PAPER ORDERS":"पूरे हुए पेपर ऑर्डर","Trade History":"ट्रेड इतिहास","Trade history loads from filled backend orders only.":"ट्रेड इतिहास में केवल पूरे हुए बैकएंड ऑर्डर दिखेंगे।",
    "Portfolio & P&L":"पोर्टफोलियो और लाभ/हानि","REFRESH":"रिफ्रेश","MARKET VALUE":"बाजार मूल्य","UNREALIZED P&L":"अवास्तविक लाभ/हानि",
    "CASH + STOCK VALUE":"नकद + शेयर मूल्य","Cash + cash-equity holdings only; F&O option positions are shown separately below.":"यहाँ केवल नकद और कैश-इक्विटी होल्डिंग हैं; F&O ऑप्शन अलग दिखते हैं।",
    "Holdings valuation will appear after sign-in and market connection.":"साइन इन और मार्केट कनेक्शन के बाद होल्डिंग मूल्य दिखेगा।",
    "STOCK":"शेयर","QTY":"मात्रा","AVG COST":"औसत लागत","LTP":"अंतिम भाव","VALUE":"मूल्य","No holdings loaded.":"कोई होल्डिंग लोड नहीं हुई।",
    "SIMULATION RECORD":"सिमुलेशन रिकॉर्ड","Order History":"ऑर्डर इतिहास","Latest orders":"नवीनतम ऑर्डर","LOAD OLDER":"पुराने लोड करें",
    "F&O PAPER SIMULATOR":"F&O पेपर सिम्युलेटर","Derivative Positions":"डेरिवेटिव पोज़िशन","Long options only · Fresh quote valuation":"केवल लॉन्ग ऑप्शन · ताज़ा भाव पर मूल्यांकन",
    "No derivative positions loaded.":"कोई डेरिवेटिव पोज़िशन लोड नहीं हुई।","F&O Order History":"F&O ऑर्डर इतिहास","No derivative orders loaded.":"कोई डेरिवेटिव ऑर्डर लोड नहीं हुआ।",
    "FUTURES RISK CHECK":"फ्यूचर्स जोखिम जाँच","Broker Margin Preview":"ब्रोकर मार्जिन अनुमान","PREVIEW ONLY":"केवल अनुमान","Lots":"लॉट","Side":"साइड","CHECK MARGIN":"मार्जिन जाँचें",
    "Select a verified futures contract from the Futures watchlist.":"फ्यूचर्स वॉचलिस्ट से सत्यापित कॉन्ट्रैक्ट चुनें।",
    "Uses Upstox broker margin estimate and fresh quote. No order is placed and no virtual cash is reserved.":"Upstox का मार्जिन अनुमान और ताज़ा भाव उपयोग होता है। कोई ऑर्डर नहीं भेजा जाता और वर्चुअल कैश आरक्षित नहीं होता।",
    "FUTURES PAPER EXECUTION":"फ्यूचर्स पेपर एक्जीक्यूशन","Futures Order Ticket":"फ्यूचर्स ऑर्डर टिकट","VIRTUAL BUY":"वर्चुअल खरीदें","VIRTUAL SELL":"वर्चुअल बेचें",
    "Select a verified Futures contract. The app will verify the live quote and broker margin before executing the virtual order.":"सत्यापित फ्यूचर्स कॉन्ट्रैक्ट चुनें। वर्चुअल ऑर्डर से पहले लाइव भाव और ब्रोकर मार्जिन जाँचा जाएगा।",
    "FUTURES SIMULATION":"फ्यूचर्स सिमुलेशन","Futures Positions & History":"फ्यूचर्स पोज़िशन और इतिहास","No futures positions loaded.":"कोई फ्यूचर्स पोज़िशन लोड नहीं हुई।",
    "FUTURES SIMULATION RECORD":"फ्यूचर्स सिमुलेशन रिकॉर्ड","Futures Order History":"फ्यूचर्स ऑर्डर इतिहास","No futures orders loaded.":"कोई फ्यूचर्स ऑर्डर लोड नहीं हुआ।",
    "DERIVATIVES WORKSPACE":"डेरिवेटिव्स वर्कस्पेस","Option Chain":"ऑप्शन चेन","NSE / BSE F&O":"NSE / BSE F&O",
    "Expiry":"एक्सपायरी","Current week":"वर्तमान सप्ताह","Next week":"अगला सप्ताह","Current month":"वर्तमान महीना","Next month":"अगला महीना",
    "LOAD OPTION CHAIN":"ऑप्शन चेन लोड करें","Select an NSE/BSE index or equity above":"ऊपर NSE/BSE इंडेक्स या शेयर चुनें",
    "Choose an underlying instrument and load a real option chain.":"अंडरलाइंग इंस्ट्रूमेंट चुनें और वास्तविक ऑप्शन चेन लोड करें।",
    "Paper trading only · No exchange orders":"केवल पेपर ट्रेडिंग · कोई वास्तविक एक्सचेंज ऑर्डर नहीं",
    "Powered by ZENURA IGNITE Technologies":"Powered by ZENURA IGNITE Technologies",
    "No orders loaded.":"कोई ऑर्डर लोड नहीं हुआ।","No filled trades loaded.":"कोई पूरा ट्रेड लोड नहीं हुआ।",
    "Protective exit":"सुरक्षात्मक निकास","Stop-loss":"स्टॉप-लॉस","Target":"लक्ष्य","Trigger price (₹)":"ट्रिगर मूल्य (₹)",
    "SET PROTECTIVE EXIT":"सुरक्षात्मक ऑर्डर सेट करें","Protective Orders":"सुरक्षात्मक ऑर्डर","Protective execution is not enabled on this gateway.":"इस गेटवे पर सुरक्षात्मक निष्पादन सक्षम नहीं है।",
    "Sign in to view protective orders.":"सुरक्षात्मक ऑर्डर देखने के लिए साइन इन करें।","No protective orders yet.":"अभी कोई सुरक्षात्मक ऑर्डर नहीं है।",
    "Protective order history could not be loaded.":"सुरक्षात्मक ऑर्डर इतिहास लोड नहीं हो सका।","Protective execution is disabled on this gateway. No new protective exits can be created.":"इस गेटवे पर सुरक्षात्मक निष्पादन बंद है। नया सुरक्षात्मक ऑर्डर नहीं बनाया जा सकता।",
    "Equity protective worker is enabled. Orders are simulated; share quantity is rechecked at execution and is not reserved.":"इक्विटी सुरक्षात्मक वर्कर सक्षम है। ऑर्डर सिमुलेटेड हैं; निष्पादन के समय शेयर मात्रा दोबारा जाँची जाती है और रिज़र्व नहीं होती।",
    "NSE/BSE cash equities only · SELL-to-close · Simulated execution.":"केवल NSE/BSE कैश इक्विटी · SELL-to-close · सिमुलेटेड निष्पादन।","CANCEL":"रद्द करें",
    "Protective order cancelled.":"सुरक्षात्मक ऑर्डर रद्द कर दिया गया।","Protective cancellation failed.":"सुरक्षात्मक ऑर्डर रद्द नहीं हो सका।","Protective order rejected.":"सुरक्षात्मक ऑर्डर अस्वीकार हुआ।",
    "S-TRADE · INDIAN MARKET":"S-TRADE · भारतीय बाजार",
    "DEMO DATA · SYNTHETIC FIXTURES":"डेमो डेटा · सिंथेटिक फिक्स्चर",
    "PAPER TRADING · ISOLATED PREVIEW":"पेपर ट्रेडिंग · अलग पूर्वावलोकन",
    "Explore the ":"अनुभव करें: ", "market terminal":"मार्केट टर्मिनल",
    "Shared Mock JSON fixtures only. No exchange feed, broker connection, account sign-in or real order execution.":"केवल साझा Mock JSON फिक्स्चर। कोई एक्सचेंज फीड, ब्रोकर कनेक्शन, खाता साइन-इन या वास्तविक ऑर्डर निष्पादन नहीं।",
    "Loading validated synthetic fixtures…":"सत्यापित सिंथेटिक फिक्स्चर लोड हो रहे हैं…",
    "Demo screens":"डेमो स्क्रीन", "Home":"होम", "Market":"मार्केट", "Watchlist":"वॉचलिस्ट", "Charts / Depth":"चार्ट / डेप्थ", "Equity":"इक्विटी", "Orders":"ऑर्डर", "Positions":"पोज़िशन", "Holdings":"होल्डिंग", "Wallet":"वॉलेट", "Profile":"प्रोफाइल", "Settings":"सेटिंग्स",
    "DEMO DATA · MOCK · SYNTHETIC ONLY":"डेमो डेटा · मॉक · केवल सिंथेटिक",
    "READ ONLY · MOCK":"केवल पढ़ें · मॉक",
    "FUTURES · LOCAL PAPER SIMULATOR":"फ्यूचर्स · लोकल पेपर सिम्युलेटर",
    "OPTIONS · LOCAL PAPER SIMULATOR":"ऑप्शंस · लोकल पेपर सिम्युलेटर",
    "Browser-memory orders and fills use deterministic fixture quotes only. No production RPC, cash ledger, margin reservation, charges, broker API or background worker is called.":"ब्राउज़र-मेमोरी ऑर्डर और फिल केवल नियत फिक्स्चर भाव उपयोग करते हैं। कोई प्रोडक्शन RPC, कैश लेजर, मार्जिन आरक्षण, शुल्क, ब्रोकर API या बैकग्राउंड वर्कर नहीं चलता।",
    "Underlying":"अंडरलाइंग", "Option type":"ऑप्शन प्रकार", "Strike":"स्ट्राइक", "Side":"साइड", "Order type":"ऑर्डर प्रकार", "Lots":"लॉट", "Futures product":"फ्यूचर्स प्रोडक्ट", "LIMIT price (₹)":"लिमिट भाव (₹)",
    "Intraday":"इंट्राडे", "Delivery":"डिलीवरी", "SIMULATE LIMIT MATCH":"लिमिट मैच सिमुलेट करें", "RESET DEMO DEPTH":"डेमो डेप्थ रीसेट करें",
    "Loading deterministic derivatives fixture…":"नियत डेरिवेटिव्स फिक्स्चर लोड हो रहा है…",
    "Select a valid synthetic contract.":"मान्य सिंथेटिक कॉन्ट्रैक्ट चुनें।", "Enter a valid LIMIT price in rupees.":"रुपये में मान्य लिमिट भाव दर्ज करें।",
    "MOCK quote selected ·":"मॉक भाव चुना गया ·", "No matching contract.":"कोई मेल खाता कॉन्ट्रैक्ट नहीं।", "Synthetic contracts loaded.":"सिंथेटिक कॉन्ट्रैक्ट लोड हुए।",
    "DEMO receipt ":"डेमो रसीद ", "DEMO order ":"डेमो ऑर्डर ", " cancelled; unfilled remainder released.":" रद्द; बिना भरा शेष हिस्सा रिलीज़ हुआ।",
    "Manual DEMO match · ":"मैनुअल डेमो मैच · ", " filled · ":" भरे · ", " partial · ":" आंशिक · ", " not eligible. No worker ran.":" योग्य नहीं। कोई वर्कर नहीं चला।",
    "DEMO fixture depth reset · ":"डेमो फिक्स्चर डेप्थ रीसेट · ", " quotes.":" भाव।",
    "OPEN DEMO POSITIONS":"खुली डेमो पोज़िशन", "DEMO ORDER RECEIPTS":"डेमो ऑर्डर रसीदें", "No open demo positions.":"कोई खुली डेमो पोज़िशन नहीं।", "No demo orders yet.":"अभी कोई डेमो ऑर्डर नहीं।",
    "ORDER ID":"ऑर्डर ID", "CONTRACT":"कॉन्ट्रैक्ट", "TYPE":"प्रकार", "EXPIRY":"एक्सपायरी", "NET QTY":"नेट मात्रा", "AVG PRICE":"औसत भाव", "RESERVED CLOSE":"आरक्षित क्लोज़", "AVAILABLE CLOSE":"उपलब्ध क्लोज़",
    "LOTS / QTY":"लॉट / मात्रा", "LIMIT":"लिमिट", "FILLED / REMAINING":"भरे / शेष", "AVG FILL":"औसत फिल", "FILL RECEIPTS":"फिल रसीदें", "STATUS":"स्थिति", "ACTION":"कार्रवाई", "CANCEL":"रद्द करें",
    "DEMO DATA · MOCK":"डेमो डेटा · मॉक", "Browser-memory DEMO DATA only. These records are not part of the account fixture, cash ledger or production portfolio.":"केवल ब्राउज़र-मेमोरी डेमो डेटा। ये रिकॉर्ड खाता फिक्स्चर, कैश लेजर या प्रोडक्शन पोर्टफोलियो का हिस्सा नहीं हैं।",
    "LOCAL FUTURES & OPTIONS POSITIONS":"लोकल फ्यूचर्स और ऑप्शंस पोज़िशन", "LOCAL FUTURES & OPTIONS FILLS":"लोकल फ्यूचर्स और ऑप्शंस फिल", "LOCAL FUTURES & OPTIONS ORDERS":"लोकल फ्यूचर्स और ऑप्शंस ऑर्डर",
    "No local Futures/Options demo positions.":"कोई लोकल फ्यूचर्स/ऑप्शंस डेमो पोज़िशन नहीं।", "No local Futures/Options demo fills.":"कोई लोकल फ्यूचर्स/ऑप्शंस डेमो फिल नहीं।", "No local Futures/Options demo orders.":"कोई लोकल फ्यूचर्स/ऑप्शंस डेमो ऑर्डर नहीं।",
    "Private Watchlists":"निजी वॉचलिस्ट","Sign in with your ZENURA Supabase account. Lists are private to your authenticated account.":"अपने ZENURA Supabase खाते से साइन इन करें। सूचियाँ केवल आपके खाते के लिए निजी हैं।",
    "Email":"ईमेल","Password":"पासवर्ड","SIGN IN":"साइन इन","CREATE ACCOUNT":"खाता बनाएँ","SIGN OUT":"साइन आउट",
    "Checking sign-in status…":"साइन-इन स्थिति जाँची जा रही है…","Sign in to access private watchlists. Your demo data stays separate.":"निजी वॉचलिस्ट देखने के लिए साइन इन करें। आपका डेमो डेटा अलग रहेगा।",
    "Filter":"फ़िल्टर","Sort":"क्रमबद्ध करें","Manual order":"मैनुअल क्रम","Symbol A–Z":"सिंबल A–Z","Symbol Z–A":"सिंबल Z–A","Price high–low":"भाव अधिक–कम","Price low–high":"भाव कम–अधिक",
    "Add from canonical MOCK catalog":"कैनोनिकल MOCK सूची से जोड़ें","ADD MOCK":"MOCK जोड़ें","MOCK PRICE":"MOCK भाव","ORDER":"क्रम","REMOVE":"हटाएँ",
    "Private watchlist instruments":"निजी वॉचलिस्ट इंस्ट्रूमेंट","This private watchlist is empty. Add a MOCK instrument to begin.":"यह निजी वॉचलिस्ट खाली है। शुरू करने के लिए MOCK इंस्ट्रूमेंट जोड़ें।",
    "No instruments match this filter.":"इस फ़िल्टर से कोई इंस्ट्रूमेंट नहीं मिला।","Unavailable saved key":"अनुपलब्ध सेव की गई कुंजी",
    "Sign in to load private watchlists.":"निजी वॉचलिस्ट लोड करने के लिए साइन इन करें।","Loading private watchlist…":"निजी वॉचलिस्ट लोड हो रही है…","Private watchlist loaded.":"निजी वॉचलिस्ट लोड हो गई।",
    "Saved securely to your private Supabase watchlist.":"आपकी निजी Supabase वॉचलिस्ट में सुरक्षित सेव हुआ।","Signed out. Private list data cleared from this screen.":"साइन आउट हो गया। निजी सूची का डेटा इस स्क्रीन से साफ़ कर दिया गया।",
    "Account changed. Loading private watchlists…":"खाता बदला। निजी वॉचलिस्ट लोड हो रही हैं…","Account created. Confirm your email, then sign in.":"खाता बन गया। ईमेल की पुष्टि करें, फिर साइन इन करें।","Account created and signed in.":"खाता बन गया और साइन इन हो गया।"
  });
  const textState=new WeakMap(),attrState=new WeakMap();
  const originalTitle=document.title;
  let language="en";
  try{language=localStorage.getItem(KEY)==="hi"?"hi":"en";}catch(_){}
  function translated(source){return language==="hi"?(HI[source]||source):source;}
  function applyText(node){
    if(!node||node.nodeType!==3)return;
    const current=node.nodeValue;
    let state=textState.get(node);
    if(!state||current!==state.rendered)state={source:current,rendered:current};
    const match=/^(\s*)([\s\S]*?)(\s*)$/.exec(state.source);
    if(!match)return;
    const next=match[1]+translated(match[2])+match[3];
    if(node.nodeValue!==next)node.nodeValue=next;
    state.rendered=next;textState.set(node,state);
  }
  function applyAttributes(el){
    if(!el||el.nodeType!==1)return;
    let state=attrState.get(el);if(!state){state={};attrState.set(el,state);}
    for(const name of ["placeholder","aria-label","title"]){
      if(!el.hasAttribute(name))continue;
      const current=el.getAttribute(name);
      if(!state[name]||current!==state[name].rendered)state[name]={source:current,rendered:current};
      const next=translated(state[name].source);
      if(current!==next)el.setAttribute(name,next);
      state[name].rendered=next;
    }
  }
  function visit(node){
    if(node.nodeType===3){applyText(node);return;}
    if(node.nodeType!==1&&node.nodeType!==9)return;
    if(node.nodeType===1){
      if(node.hasAttribute("data-en")&&node.hasAttribute("data-hi")&&node.children.length===0){
        const next=node.getAttribute(language==="hi"?"data-hi":"data-en");
        if(node.textContent!==next)node.textContent=next;
      }
      applyAttributes(node);
    }
    for(const child of node.childNodes)visit(child);
  }
  function render(){
    document.documentElement.lang=language==="hi"?"hi":"en";
    document.title=translated(originalTitle);
    visit(document.body);
    const button=document.getElementById("paper-language-toggle");
    if(button){button.textContent=language==="en"?"हिन्दी":"English";button.setAttribute("aria-label",language==="en"?"Switch to Hindi":"अंग्रेज़ी में बदलें");}
    window.dispatchEvent(new CustomEvent("zenura-language-change",{detail:{language}}));
  }
  function setLanguage(next){
    language=next==="hi"?"hi":"en";
    try{localStorage.setItem(KEY,language);}catch(_){}
    render();
  }
  const button=document.getElementById("paper-language-toggle");
  button?.addEventListener("click",()=>setLanguage(language==="en"?"hi":"en"));
  window.addEventListener("storage",event=>{if(event.key===KEY)setLanguage(event.newValue);});
  window.ZenuraLanguage={getLanguage:()=>language,t:translated,setLanguage,apply:render};
  render();
  const observer=new MutationObserver(records=>{
    for(const record of records){
      if(record.type==="characterData")applyText(record.target);
      else for(const node of record.addedNodes)visit(node);
    }
  });
  observer.observe(document.body,{subtree:true,childList:true,characterData:true});
})();