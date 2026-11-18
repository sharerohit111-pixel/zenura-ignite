/* ZENURA IGNITE market catalog — only instruments routed through the existing Binance Spot paper-trading engine. */
(function(){
  'use strict';
  window.ZENURA_MARKET_ASSETS = Object.freeze([
    {s:'BTCUSDT',base:'BTC',name:'Bitcoin',icon:'₿',group:'crypto'},
    {s:'ETHUSDT',base:'ETH',name:'Ethereum',icon:'◆',group:'crypto'},
    {s:'BNBUSDT',base:'BNB',name:'BNB',icon:'◆',group:'crypto'},
    {s:'SOLUSDT',base:'SOL',name:'Solana',icon:'◎',group:'crypto'},
    {s:'XRPUSDT',base:'XRP',name:'XRP',icon:'✕',group:'crypto'},
    {s:'ADAUSDT',base:'ADA',name:'Cardano',icon:'₳',group:'crypto'},
    {s:'DOGEUSDT',base:'DOGE',name:'Dogecoin',icon:'Ð',group:'crypto'},
    {s:'AVAXUSDT',base:'AVAX',name:'Avalanche',icon:'▲',group:'crypto'},
    {s:'PAXGUSDT',base:'PAXG',name:'Pax Gold',icon:'◆',group:'gold'},
    {s:'XAUTUSDT',base:'XAUT',name:'Tether Gold',icon:'◆',group:'gold'}
  ]);
})();
