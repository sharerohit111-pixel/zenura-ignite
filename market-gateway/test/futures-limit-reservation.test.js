"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {
  allocateFuturesLimitReservation,
  releaseFuturesLimitRemainder
}=require("../lib/futures-limit-reservation");

test("Futures LIMIT partial fills transfer integer-paise reservation without over-allocation",()=>{
  let state={remainingReservationPaise:2000,remainingQuantity:3};
  const allocations=[];
  for(let i=0;i<3;i++){
    const next=allocateFuturesLimitReservation({...state,fillQuantity:1});
    allocations.push(next.allocatedReservationPaise);
    state={remainingReservationPaise:next.remainingReservationPaise,remainingQuantity:next.remainingQuantity};
  }
  assert.deepEqual(allocations,[666,667,667]);
  assert.equal(allocations.reduce((a,b)=>a+b,0),2000);
  assert.deepEqual(state,{remainingReservationPaise:0,remainingQuantity:0});
});

test("Futures LIMIT final partial fill receives the exact rounding residual",()=>{
  const first=allocateFuturesLimitReservation({remainingReservationPaise:1001,remainingQuantity:4,fillQuantity:1});
  const second=allocateFuturesLimitReservation({remainingReservationPaise:first.remainingReservationPaise,remainingQuantity:first.remainingQuantity,fillQuantity:2});
  const final=allocateFuturesLimitReservation({remainingReservationPaise:second.remainingReservationPaise,remainingQuantity:second.remainingQuantity,fillQuantity:1});
  assert.equal(first.allocatedReservationPaise,250);
  assert.equal(second.allocatedReservationPaise,500);
  assert.equal(final.allocatedReservationPaise,251);
  assert.equal(first.allocatedReservationPaise+second.allocatedReservationPaise+final.allocatedReservationPaise,1001);
});

test("Futures LIMIT cancellation releases only the still-pending reservation remainder",()=>{
  const filled=allocateFuturesLimitReservation({remainingReservationPaise:2000,remainingQuantity:3,fillQuantity:1});
  const cancelled=releaseFuturesLimitRemainder({remainingReservationPaise:filled.remainingReservationPaise,remainingQuantity:filled.remainingQuantity});
  assert.equal(filled.allocatedReservationPaise+cancelled.releasedReservationPaise,2000);
  assert.deepEqual(cancelled,{releasedReservationPaise:1334,remainingReservationPaise:0,remainingQuantity:0});
});

test("Futures LIMIT reservation allocation rejects unsafe or impossible quantities",()=>{
  assert.throws(()=>allocateFuturesLimitReservation({remainingReservationPaise:-1,remainingQuantity:3,fillQuantity:1}),TypeError);
  assert.throws(()=>allocateFuturesLimitReservation({remainingReservationPaise:10,remainingQuantity:0,fillQuantity:1}),TypeError);
  assert.throws(()=>allocateFuturesLimitReservation({remainingReservationPaise:10,remainingQuantity:2,fillQuantity:3}),RangeError);
  assert.throws(()=>allocateFuturesLimitReservation({remainingReservationPaise:Number.MAX_SAFE_INTEGER+1,remainingQuantity:2,fillQuantity:1}),TypeError);
});


test("Futures LIMIT reservation allocation conserves every paise across varied fill partitions",()=>{
  for(let reserved=0;reserved<=257;reserved++){
    for(let quantity=1;quantity<=12;quantity++){
      let remainingReservationPaise=reserved;
      let remainingQuantity=quantity;
      let transferred=0;
      while(remainingQuantity>0){
        const fillQuantity=Math.min(remainingQuantity,1+(remainingQuantity%3));
        const next=allocateFuturesLimitReservation({remainingReservationPaise,remainingQuantity,fillQuantity});
        transferred+=next.allocatedReservationPaise;
        remainingReservationPaise=next.remainingReservationPaise;
        remainingQuantity=next.remainingQuantity;
      }
      assert.equal(transferred,reserved,`reservation ${reserved} paise across ${quantity} units`);
      assert.equal(remainingReservationPaise,0);
    }
  }
});
