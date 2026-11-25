export function shippingPolicyMarkup(policy) {
  const values = [
    policy?.rates?.italy,
    policy?.rates?.europe,
    policy?.rates?.world,
    policy?.freeShipping?.minimumSubtotal,
  ];
  if (
    policy?.currency !== "EUR" ||
    values.some((value) => typeof value !== "number" || !Number.isFinite(value) || value < 0) ||
    !Array.isArray(policy?.freeShipping?.zones) ||
    policy.freeShipping.zones.join(",") !== "italy,europe"
  ) {
    throw new Error("File spedizioni non valido: attesi importi EUR e zone gratuite italy,europe.");
  }
  const money = new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR" });
  const amount = (value) => money.format(value);
  const { rates, freeShipping } = policy;
  return `<p>Italia ${amount(rates.italy)} · Europa e Regno Unito ${amount(rates.europe)} · Resto del mondo ${amount(rates.world)}.</p><p>Spedizione gratuita da ${amount(freeShipping.minimumSubtotal)} di totale ordine, con qualsiasi prodotto, in Italia, Europa e Regno Unito. Nel resto del mondo il costo resta ${amount(rates.world)}.</p>`;
}
