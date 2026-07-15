// Unmatched routes clear the slot: a soft nav elsewhere (e.g. "View full post →")
// closes any open sheet, and a hard load of /today matches here so the slot
// renders nothing while the underlying page shows the full /today.
export default function ModalCatchAll() {
  return null;
}
