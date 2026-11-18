// A product selection changes only the chosen garment, its description and its shop link.
const models = {
  964: {
    name: "964",
    image: "media/964-front.webp",
    description:
      "Gli anni Novanta in una linea. Ricamo chiaro su cotone navy, vestibilità regular unisex.",
    alt: "T-shirt 964 LuckyLap navy, vista frontale con ricamo sul petto",
    url: "https://luckylap.com/products/964-tshirt",
  },
  f40: {
    name: "F40",
    image: "media/f40-front.webp",
    description:
      "Il profilo dell’icona italiana del 1987. Ricamo rosso su cotone biologico bianco, vestibilità regular unisex.",
    alt: "T-shirt F40 LuckyLap bianca con ricamo rosso della supercar italiana",
    url: "https://luckylap.com/products/f40-tshirt",
  },
  project: {
    name: "Project ’88",
    image: "media/project-front.webp",
    description:
      "La memoria di una stagione di Formula 1. Ricamo multicolore su cotone biologico bianco, vestibilità regular unisex.",
    alt: "T-shirt Project ’88 LuckyLap bianca con monoposto ricamata a colori",
    url: "https://luckylap.com/products/project-88-white-t-shirt",
  },
  "300sl": {
    name: "300 SL",
    image: "media/300sl-front.webp",
    description:
      "La silhouette con le porte ad ali di gabbiano. Ricamo a contrasto su cotone biologico azzurro, vestibilità regular unisex.",
    alt: "T-shirt 300 SL LuckyLap azzurra con silhouette ricamata in bianco",
    url: "https://luckylap.com/products/300-sl-t-shirt",
  },
};
const image = document.querySelector("#model-image");
const pictureLink = document.querySelector("#model-photo-link");
const productLink = document.querySelector("#model-link");
document.querySelector(".model-choices").disabled = false;
let selection = 0;
let loadedModel = "964";
const modelSources = (model) =>
  `${model.image.replace(".webp", "-480.webp")} 480w, ${model.image.replace(".webp", "-960.webp")} 960w, ${model.image} 1400w`;
document.querySelectorAll('input[name="model"]').forEach((input) => {
  input.addEventListener("change", async () => {
    const ticket = ++selection;
    const model = models[input.value];
    if (!model) return;
    const pendingImage = new Image();
    pendingImage.sizes = image.sizes;
    pendingImage.srcset = modelSources(model);
    pendingImage.src = model.image;
    pictureLink.classList.add("is-loading");
    pictureLink.setAttribute("aria-busy", "true");
    try {
      await pendingImage.decode();
      if (ticket !== selection) return;
      image.src = model.image;
      image.srcset = modelSources(model);
      image.alt = model.alt;
      document.querySelector("#model-name").textContent = model.name;
      document.querySelector("#model-description").textContent = model.description;
      productLink.firstChild.textContent = `Vedi la T-shirt ${model.name} `;
      productLink.href = model.url;
      pictureLink.href = model.url;
      pictureLink.setAttribute("aria-label", `Vedi la T-shirt ${model.name} nello shop`);
      document.querySelector(".model-error")?.remove();
      loadedModel = input.value;
    } catch {
      if (ticket !== selection) return;
      document.querySelector(`input[name="model"][value="${loadedModel}"]`).checked = true;
      let error = document.querySelector(".model-error");
      if (!error) {
        error = document.createElement("p");
        error.className = "model-error";
        error.setAttribute("role", "status");
        productLink.after(error);
      }
      error.textContent = "La foto non si è caricata. Riprova a scegliere la silhouette.";
    } finally {
      if (ticket === selection) {
        pictureLink.classList.remove("is-loading");
        pictureLink.removeAttribute("aria-busy");
      }
    }
  });
});
// Localise the shared kit's generated menu control without changing vendor files.
document
  .querySelectorAll(".nav__expand")
  .forEach((button) => button.setAttribute("aria-label", "Mostra le categorie della collezione"));
const menuToggle = document.querySelector(".nav__toggle");
if (menuToggle) {
  const labelMenu = () => {
    const open = menuToggle.getAttribute("aria-expanded") === "true";
    menuToggle.setAttribute("aria-label", open ? "Chiudi il menu" : "Apri il menu");
    document.querySelector("main").inert = open;
    document.querySelector("footer").inert = open;
  };
  new MutationObserver(labelMenu).observe(menuToggle, {
    attributes: true,
    attributeFilter: ["aria-expanded"],
  });
  document.querySelector(".skip-link").addEventListener("click", () => {
    if (menuToggle.getAttribute("aria-expanded") === "true") menuToggle.click();
  });
  document.querySelector("header").addEventListener("keydown", (event) => {
    if (event.key !== "Tab" || menuToggle.getAttribute("aria-expanded") !== "true") return;
    const controls = [...document.querySelectorAll("header a,header button")].filter((control) => {
      const box = control.getBoundingClientRect();
      return (
        box.width > 0 &&
        box.height > 0 &&
        box.top >= 0 &&
        getComputedStyle(control).visibility !== "hidden"
      );
    });
    const first = controls[0];
    const last = controls.at(-1);
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });
}
