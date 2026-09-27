import { getUncachableStripeClient } from "./stripeClient";

const PLANS = [
  {
    name: "Starter",
    description: "1 client, up to 200 AI replies per month",
    planKey: "starter",
    order: "1",
    maxClients: "1",
    maxReplies: "200",
    monthlyPrice: 4900,
    yearlyPrice: 47040,
  },
  {
    name: "Growth",
    description: "Up to 5 clients, up to 1,000 AI replies per month",
    planKey: "growth",
    order: "2",
    maxClients: "5",
    maxReplies: "1000",
    monthlyPrice: 14900,
    yearlyPrice: 143040,
  },
  {
    name: "Agency",
    description: "Unlimited clients, 5,000+ AI replies per month",
    planKey: "agency",
    order: "3",
    maxClients: "unlimited",
    maxReplies: "5000",
    monthlyPrice: 39900,
    yearlyPrice: 383040,
  },
];

async function seedProducts() {
  const stripe = await getUncachableStripeClient();

  console.log("Seeding DraftFly plans in Stripe...\n");

  for (const plan of PLANS) {
    const existing = await stripe.products.search({
      query: `metadata['plan_key']:'${plan.planKey}' AND active:'true'`,
    });

    if (existing.data.length > 0) {
      console.log(`[skip] ${plan.name} already exists (${existing.data[0].id})`);
      continue;
    }

    const product = await stripe.products.create({
      name: plan.name,
      description: plan.description,
      metadata: {
        plan_key: plan.planKey,
        order: plan.order,
        max_clients: plan.maxClients,
        max_replies: plan.maxReplies,
      },
    });

    const [monthly, yearly] = await Promise.all([
      stripe.prices.create({
        product: product.id,
        unit_amount: plan.monthlyPrice,
        currency: "usd",
        recurring: { interval: "month" },
        metadata: { billing_period: "monthly" },
      }),
      stripe.prices.create({
        product: product.id,
        unit_amount: plan.yearlyPrice,
        currency: "usd",
        recurring: { interval: "year" },
        metadata: { billing_period: "yearly" },
      }),
    ]);

    console.log(`[ok] ${plan.name}: product=${product.id}`);
    console.log(`     monthly=$${plan.monthlyPrice / 100}/mo  price=${monthly.id}`);
    console.log(`     yearly=$${plan.yearlyPrice / 100}/yr   price=${yearly.id}\n`);
  }

  console.log("Done. Webhooks will sync products to the database automatically.");
}

seedProducts().catch((err) => {
  console.error("Error seeding products:", err.message);
  process.exit(1);
});
