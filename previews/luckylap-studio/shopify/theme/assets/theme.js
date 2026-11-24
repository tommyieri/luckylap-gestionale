(() => {
  document.documentElement.classList.replace("no-js", "js");
  function initialise(scope) {
    scope.querySelectorAll("[data-product-section]").forEach((section) => {
      if (section.dataset.initialised) return;
      section.dataset.initialised = "true";
      const form = section.querySelector("[data-product-form]");
      const select = form?.querySelector("[data-variant-select]");
      const enhanced = form?.querySelector(".enhanced-variant-picker");
      if (!form || !select || !select.options.length) return;
      let variants;
      try {
        variants = Array.from(select.options).map((option) => ({
          option,
          values: JSON.parse(option.dataset.options),
          available: option.dataset.available === "true",
        }));
      } catch {
        return;
      }
      const groups = Array.from(form.querySelectorAll("[data-option-index]"));
      let selected = (
        variants.find((variant) => variant.option.value === select.value) || variants[0]
      ).values.slice();
      const button = form.querySelector("[data-add-to-cart]");
      const stock = section.querySelector("[data-product-stock]");
      const price = section.querySelector("[data-product-price]");
      const image = section.querySelector("[data-product-image]");
      const quantity = form.querySelector('[name="quantity"]');
      const imageNotice = section.querySelector("[data-variant-image-notice]");
      function update(changeUrl) {
        const variant = variants.find((candidate) =>
          candidate.values.every((value, index) => value === selected[index]),
        );
        groups.forEach((group, index) => {
          group.querySelectorAll("[data-option-value]").forEach((choice) => {
            const value = choice.dataset.optionValue;
            const matching = variants.filter((candidate) =>
              candidate.values.every((candidateValue, candidateIndex) =>
                candidateIndex === index
                  ? candidateValue === value
                  : candidateValue === selected[candidateIndex],
              ),
            );
            choice.setAttribute("aria-pressed", String(value === selected[index]));
            choice.classList.toggle("is-selected", value === selected[index]);
            choice.toggleAttribute(
              "data-unavailable",
              !matching.some((candidate) => candidate.available),
            );
            choice.disabled = matching.length === 0;
          });
        });
        const canPurchase = Boolean(variant?.available);
        button.disabled = !canPurchase;
        button.textContent = variant
          ? canPurchase
            ? button.dataset.addLabel
            : button.dataset.soldLabel
          : button.dataset.unavailableLabel;
        stock.textContent = variant
          ? canPurchase
            ? stock.dataset.availableLabel
            : button.dataset.soldLabel
          : button.dataset.unavailableLabel;
        if (!variant) {
          select.value = "";
          return;
        }
        select.value = variant.option.value;
        price.textContent = variant.option.dataset.price;
        quantity.min = variant.option.dataset.min || "1";
        quantity.step = variant.option.dataset.step || "1";
        if (variant.option.dataset.max) quantity.max = variant.option.dataset.max;
        else quantity.removeAttribute("max");
        quantity.value = quantity.min;
        if (image) {
          const nextImage = variant.option.dataset.image || section.dataset.defaultImage;
          if (nextImage) {
            image.removeAttribute("srcset");
            image.src = nextImage;
            image.alt = variant.option.dataset.image
              ? variant.option.dataset.imageAlt || ""
              : section.dataset.defaultImageAlt || "";
          }
        }
        if (imageNotice) imageNotice.hidden = Boolean(variant.option.dataset.image);
        if (changeUrl) {
          const url = new URL(window.location.href);
          url.searchParams.set("variant", variant.option.value);
          history.replaceState({}, "", url);
        }
      }
      if (enhanced && groups.length) {
        enhanced.hidden = false;
        form.querySelector(".native-variant-picker").hidden = true;
        groups.forEach((group, index) =>
          group.querySelectorAll("[data-option-value]").forEach((choice) =>
            choice.addEventListener("click", () => {
              selected[index] = choice.dataset.optionValue;
              update(true);
            }),
          ),
        );
      }
      select.addEventListener("change", () => {
        const variant = variants.find((candidate) => candidate.option.value === select.value);
        if (variant) selected = variant.values.slice();
        update(true);
      });
      form.addEventListener("submit", (event) => {
        if (button.disabled || !select.value) {
          event.preventDefault();
          stock.focus();
        }
      });
      update(false);
    });
    scope.querySelectorAll("[data-gallery-image]").forEach((link) => {
      if (link.dataset.initialised) return;
      link.dataset.initialised = "true";
      link.addEventListener("click", (event) => {
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        const image = link.closest("[data-product-section]")?.querySelector("[data-product-image]");
        if (!image) return;
        event.preventDefault();
        image.removeAttribute("srcset");
        image.src = link.dataset.imageSrc;
        image.alt = link.dataset.imageAlt || "";
      });
    });
    scope.querySelectorAll("[data-featured-picker]").forEach((picker) => {
      if (picker.dataset.initialised) return;
      picker.dataset.initialised = "true";
      const buttons = Array.from(picker.querySelectorAll("[data-feature-product]"));
      buttons.forEach((button) =>
        button.addEventListener("click", () => {
          buttons.forEach((candidate) =>
            candidate.setAttribute("aria-pressed", String(candidate === button)),
          );
          const image = picker.querySelector("img");
          if (image && button.dataset.image) {
            image.removeAttribute("srcset");
            image.src = button.dataset.image;
            image.alt = button.dataset.title;
          }
          picker.querySelector("[data-feature-title]").textContent = button.dataset.title;
          picker.querySelector("[data-feature-price]").textContent = button.dataset.price;
          picker.querySelectorAll("[data-feature-link]").forEach((link) => {
            link.href = button.dataset.url;
          });
        }),
      );
    });
    scope.querySelectorAll("[data-filter-section]").forEach((section) => {
      if (section.dataset.initialised) return;
      section.dataset.initialised = "true";
      const buttons = Array.from(section.querySelectorAll("[data-product-filter]"));
      buttons.forEach((button) =>
        button.addEventListener("click", () => {
          buttons.forEach((candidate) =>
            candidate.setAttribute("aria-pressed", String(candidate === button)),
          );
          section.querySelectorAll("[data-product-card]").forEach((card) => {
            card.hidden =
              button.dataset.productFilter !== "all" &&
              card.dataset.productType !== button.dataset.productFilter;
          });
        }),
      );
    });
  }
  initialise(document);
  document.addEventListener("shopify:section:load", (event) => initialise(event.target));
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    document.querySelectorAll(".mobile-menu[open], .nav-dropdown[open]").forEach((menu) => {
      menu.open = false;
      menu.querySelector("summary")?.focus();
    });
  });
})();
