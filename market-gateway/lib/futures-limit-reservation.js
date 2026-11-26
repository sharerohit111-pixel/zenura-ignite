"use strict";

// Pure integer-paise reservation allocation for the future Futures LIMIT ledger.
// This helper is deliberately not wired to an order route or worker. SQL remains
// authoritative for atomic reservation transfer, fills, cancellation and races.

function assertSafeInteger(value,name,{min=0}={}){
  if(!Number.isSafeInteger(value)||value<min){
    throw new TypeError(`${name} must be a safe integer >= ${min}`);
  }
}

function allocateFuturesLimitReservation({remainingReservationPaise,remainingQuantity,fillQuantity}){
  assertSafeInteger(remainingReservationPaise,"remainingReservationPaise");
  assertSafeInteger(remainingQuantity,"remainingQuantity",{min:1});
  assertSafeInteger(fillQuantity,"fillQuantity",{min:1});
  if(fillQuantity>remainingQuantity)throw new RangeError("fillQuantity exceeds remainingQuantity");

  // Allocate the exact residual on the final fill. Earlier fills round down so
  // the sum of all transfers can never exceed the order's reserved paise.
  const allocatedReservationPaise=fillQuantity===remainingQuantity
    ? remainingReservationPaise
    : Number((BigInt(remainingReservationPaise)*BigInt(fillQuantity))/BigInt(remainingQuantity));
  const nextRemainingReservationPaise=remainingReservationPaise-allocatedReservationPaise;
  const nextRemainingQuantity=remainingQuantity-fillQuantity;

  return Object.freeze({
    allocatedReservationPaise,
    remainingReservationPaise:nextRemainingReservationPaise,
    remainingQuantity:nextRemainingQuantity,
    fullyAllocated:nextRemainingQuantity===0
  });
}

function releaseFuturesLimitRemainder({remainingReservationPaise,remainingQuantity}){
  assertSafeInteger(remainingReservationPaise,"remainingReservationPaise");
  assertSafeInteger(remainingQuantity,"remainingQuantity");
  return Object.freeze({
    releasedReservationPaise:remainingReservationPaise,
    remainingReservationPaise:0,
    remainingQuantity:0
  });
}

module.exports={allocateFuturesLimitReservation,releaseFuturesLimitRemainder};
