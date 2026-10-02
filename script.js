// PayPal funds settle into the account tied to the client ID below.
// Paste your live PayPal REST app client ID before publishing.
const storefrontConfig = {
    orderEmail: "admin@notetakerbibles.com",
    paypal: {
        clientId: "AbQCzoYIbysAc4zkiX7T5hHgfdvK6KeKw5pKDpW1UUYZlzZU9_uu0zvCe4HwmWbSdyIdgf5o3L837Ixq",
        currency: "USD",
        intent: "CAPTURE",
        enableFunding: ["venmo", "paylater", "card"],
    },
    promoCodes: {
        AGAPE: {
            code: "AGAPE",
            discountPercent: 10,
        },
    },
    products: {
        ephesians: { name: "Ephesians", price: 18.0 },
        john: { name: "John", price: 20.0 },
        romans: { name: "Romans", price: 20.0 },
        revelation: { name: "Revelation", price: 20.0 },
        philippians: { name: "Philippians", price: 18.0 },
    },
};

const cartStorageKey = "take-note-bibles-cart";
const promoStorageKey = "take-note-bibles-promo";
const quantityState = Object.fromEntries(
    Object.keys(storefrontConfig.products).map((bookId) => [bookId, 1]),
);

let cart = loadCart();
let appliedPromoCode = loadPromoCode();
let toastTimeout = 0;
let paypalScriptPromise = null;
let paypalButtonActions = null;
let currentOrderReference = "";

const navToggle = document.querySelector(".navToggle");
const navLinks = document.querySelectorAll(".navLink");
const tabPanels = document.querySelectorAll("[data-tab-panel]");
const booksGrid = document.querySelector(".booksGrid");
const cartItemsElement = document.getElementById("cart-items");
const cartSubtotalElement = document.getElementById("cart-subtotal");
const cartDiscountRow = document.getElementById("cart-discount-row");
const cartDiscountLabelElement = document.getElementById("cart-discount-label");
const cartDiscountElement = document.getElementById("cart-discount");
const cartTotalElement = document.getElementById("cart-total");
const orderForm = document.getElementById("order-form");
const contactForm = document.getElementById("contact-form");
const orderSubjectField = document.getElementById("order-subject");
const orderNextField = document.getElementById("order-next");
const orderSummaryField = document.getElementById("order-summary");
const orderTotalField = document.getElementById("order-total-field");
const promoCodeField = document.getElementById("promo-code-field");
const discountAmountField = document.getElementById("discount-amount-field");
const orderReferenceField = document.getElementById("order-reference-field");
const paymentProviderField = document.getElementById("payment-provider-field");
const paymentStatusField = document.getElementById("payment-status-field");
const paypalOrderIdField = document.getElementById("paypal-order-id-field");
const paypalCaptureIdField = document.getElementById("paypal-capture-id-field");
const paypalPayerEmailField = document.getElementById("paypal-payer-email-field");
const paypalPayerNameField = document.getElementById("paypal-payer-name-field");
const promoCodeInput = document.getElementById("promo-code-input");
const applyPromoButton = document.getElementById("apply-promo-button");
const promoFeedback = document.getElementById("promo-feedback");
const checkoutNote = document.getElementById("checkout-note");
const paymentConfigNote = document.getElementById("payment-config-note");
const paypalSuccessNote = document.getElementById("paypal-success-note");
const paypalButtonContainer = document.getElementById("paypal-button-container");
const contactEmailLink = document.getElementById("contact-email");
const toast = document.getElementById("toast");
const reviewOrder = document.getElementById("review-order");
const motionBehavior = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";

function updateOrderShortcut() {
    const count = cart.reduce((total, item) => total + item.quantity, 0);
    reviewOrder.hidden = count === 0 || !document.getElementById("purchase").classList.contains("isActive");
    reviewOrder.textContent = `Review order (${count}) · ${formatCurrency(cartTotal())}`;
}

function loadCart() {
    try {
        const savedCart = window.sessionStorage.getItem(cartStorageKey);
        const parsedCart = savedCart ? JSON.parse(savedCart) : [];
        return Array.isArray(parsedCart) ? parsedCart : [];
    } catch (error) {
        return [];
    }
}

function saveCart() {
    try {
        window.sessionStorage.setItem(cartStorageKey, JSON.stringify(cart));
    } catch (error) {
        // Ignore storage failures so the storefront still works locally.
    }
}

function loadPromoCode() {
    try {
        const savedCode = (window.sessionStorage.getItem(promoStorageKey) || "").trim().toUpperCase();
        return storefrontConfig.promoCodes[savedCode] ? savedCode : "";
    } catch (error) {
        return "";
    }
}

function savePromoCode() {
    try {
        if (appliedPromoCode) {
            window.sessionStorage.setItem(promoStorageKey, appliedPromoCode);
            return;
        }

        window.sessionStorage.removeItem(promoStorageKey);
    } catch (error) {
        // Ignore storage failures so promo codes still work locally.
    }
}

function roundCurrency(value) {
    return Math.round(value * 100) / 100;
}

function formatCurrency(value) {
    return new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: storefrontConfig.paypal.currency,
    }).format(value);
}

function cartSubtotal() {
    return cart.reduce((total, item) => total + item.price * item.quantity, 0);
}

function currentPromo() {
    return storefrontConfig.promoCodes[appliedPromoCode] || null;
}

function cartDiscount() {
    const promo = currentPromo();

    if (!promo || cart.length === 0) {
        return 0;
    }

    return roundCurrency((cartSubtotal() * promo.discountPercent) / 100);
}

function cartTotal() {
    return roundCurrency(Math.max(0, cartSubtotal() - cartDiscount()));
}

function paypalIsConfigured() {
    const { clientId } = storefrontConfig.paypal;
    return Boolean(clientId) && !clientId.includes("REPLACE_WITH_YOUR_PAYPAL_CLIENT_ID");
}

function currentReturnUrl() {
    return `${window.location.href.split("#")[0]}#purchase`;
}

function buildPayPalSdkUrl() {
    const params = new URLSearchParams({
        "client-id": storefrontConfig.paypal.clientId,
        currency: storefrontConfig.paypal.currency,
        intent: storefrontConfig.paypal.intent.toLowerCase(),
        commit: "true",
        components: "buttons",
        "enable-funding": storefrontConfig.paypal.enableFunding.join(","),
    });

    return `https://www.paypal.com/sdk/js?${params.toString()}`;
}

function loadPayPalSdk() {
    if (window.paypal && typeof window.paypal.Buttons === "function") {
        return Promise.resolve(window.paypal);
    }

    if (paypalScriptPromise) {
        return paypalScriptPromise;
    }

    paypalScriptPromise = new Promise((resolve, reject) => {
        const script = document.createElement("script");
        script.src = buildPayPalSdkUrl();
        script.async = true;
        script.dataset.pageType = "checkout";

        script.onload = () => {
            if (window.paypal && typeof window.paypal.Buttons === "function") {
                resolve(window.paypal);
                return;
            }

            reject(new Error("PayPal SDK loaded without Buttons."));
        };

        script.onerror = () => {
            reject(new Error("Unable to load the PayPal SDK."));
        };

        document.head.appendChild(script);
    });

    return paypalScriptPromise;
}

function syncFormTargets() {
    const formAction = `https://formsubmit.co/${storefrontConfig.orderEmail}`;
    orderForm.action = formAction;
    orderForm.target = "order-email-target";
    contactForm.action = formAction;
    contactEmailLink.textContent = storefrontConfig.orderEmail;
    contactEmailLink.href = `mailto:${storefrontConfig.orderEmail}`;
    orderNextField.value = currentReturnUrl();
}

function syncQuantityDisplays() {
    document.querySelectorAll(".bookCard").forEach((card) => {
        const bookId = card.dataset.book;
        const display = card.querySelector("[data-qty-display]");

        if (display) {
            display.textContent = String(quantityState[bookId] || 1);
            display.setAttribute("aria-live", "polite");
        }
        const name = storefrontConfig.products[bookId].name;
        card.querySelectorAll("[data-qty-change]").forEach((button) => {
            const decrease = Number(button.dataset.qtyChange) < 0;
            button.setAttribute("aria-label", `${decrease ? "Decrease" : "Increase"} ${name} quantity`);
            button.disabled = decrease && quantityState[bookId] <= 1;
        });
        card.querySelector("[data-add-to-cart]").setAttribute("aria-label", `Add ${name} to order`);
    });
}

function clearPaymentFields() {
    orderReferenceField.value = "";
    promoCodeField.value = "";
    discountAmountField.value = "";
    paymentProviderField.value = "";
    paymentStatusField.value = "";
    paypalOrderIdField.value = "";
    paypalCaptureIdField.value = "";
    paypalPayerEmailField.value = "";
    paypalPayerNameField.value = "";
}

function syncPromoInput() {
    promoCodeInput.value = appliedPromoCode;
}

function setPromoFeedback(message = "", type = "") {
    promoFeedback.classList.remove("isSuccess", "isError");

    if (!message) {
        promoFeedback.hidden = true;
        promoFeedback.textContent = "";
        return;
    }

    promoFeedback.hidden = false;
    promoFeedback.textContent = message;

    if (type === "success") {
        promoFeedback.classList.add("isSuccess");
        return;
    }

    if (type === "error") {
        promoFeedback.classList.add("isError");
    }
}

function syncOrderSummaryFields(reference = "") {
    const promo = currentPromo();
    const discount = cartDiscount();
    const total = cartTotal();
    const summaryLines = cart.map(
        (item) => `${item.name} x${item.quantity} - ${formatCurrency(item.price * item.quantity)}`,
    );

    if (promo && discount > 0) {
        summaryLines.push(`Promo ${promo.code} (-${promo.discountPercent}%) - -${formatCurrency(discount)}`);
    }

    if (summaryLines.length > 0) {
        summaryLines.push(`Total - ${formatCurrency(total)}`);
    }

    orderSummaryField.value = summaryLines.join("\n");
    orderTotalField.value = formatCurrency(total);
    promoCodeField.value = promo ? promo.code : "";
    discountAmountField.value = discount > 0 ? formatCurrency(discount) : "";
    orderReferenceField.value = reference;
}

function renderCartTotals() {
    updateOrderShortcut();
    const promo = currentPromo();
    const subtotal = cartSubtotal();
    const discount = cartDiscount();

    cartSubtotalElement.textContent = formatCurrency(subtotal);
    cartTotalElement.textContent = formatCurrency(cartTotal());

    if (promo && discount > 0) {
        cartDiscountRow.hidden = false;
        cartDiscountLabelElement.textContent = `${promo.code} (-${promo.discountPercent}%)`;
        cartDiscountElement.textContent = `-${formatCurrency(discount)}`;
        return;
    }

    cartDiscountRow.hidden = true;
    cartDiscountLabelElement.textContent = "Promo Discount";
    cartDiscountElement.textContent = `-${formatCurrency(0)}`;
}

function renderCart() {
    if (cart.length === 0) {
        cartItemsElement.innerHTML = '<p class="emptyState">Your cart is empty.</p>';
        renderCartTotals();
        syncOrderSummaryFields("");
        saveCart();
        updatePayPalButtonState();
        return;
    }

    const html = cart
        .map((item) => {
            const lineTotal = item.price * item.quantity;

            return `
                <div class="cartItem">
                    <div class="cartMeta">
                        <span class="cartName">${item.name}</span>
                        <span class="cartQuantity">Quantity: ${item.quantity}</span>
                    </div>
                    <span class="cartLineTotal">${formatCurrency(lineTotal)}</span>
                    <button type="button" class="removeButton" data-remove-book="${item.id}" aria-label="Remove ${item.name} from order">Remove</button>
                </div>
            `;
        })
        .join("");

    cartItemsElement.innerHTML = html;
    renderCartTotals();
    syncOrderSummaryFields(currentOrderReference);
    saveCart();
    updatePayPalButtonState();
}

function updateCheckoutMessaging() {
    if (paypalIsConfigured()) {
        paymentConfigNote.hidden = true;
        checkoutNote.textContent = "Fill out your details, then pay securely with PayPal below.";
        return;
    }

    paymentConfigNote.hidden = false;
    paymentConfigNote.textContent =
        "Add your live PayPal client ID in script.js to turn on checkout for your business account.";
    checkoutNote.textContent =
        "Your cart is ready, but PayPal checkout will not go live until the client ID is added.";
}

function showToast(message) {
    if (!toast) {
        return;
    }

    toast.textContent = message;
    toast.classList.add("isVisible");

    window.clearTimeout(toastTimeout);
    toastTimeout = window.setTimeout(() => {
        toast.classList.remove("isVisible");
    }, 2400);
}

function buildOrderReference() {
    return `TNB-${Date.now()}-${Math.floor(Math.random() * 10000)
        .toString()
        .padStart(4, "0")}`;
}

function isCheckoutReady() {
    return cart.length > 0 && orderForm.checkValidity();
}

function updatePayPalButtonState() {
    if (!paypalButtonActions) {
        return;
    }

    if (isCheckoutReady()) {
        paypalButtonActions.enable();
        return;
    }

    paypalButtonActions.disable();
}

function addToCart(bookId) {
    const product = storefrontConfig.products[bookId];

    if (!product) {
        return;
    }

    const selectedQuantity = quantityState[bookId];
    const existingItem = cart.find((item) => item.id === bookId);

    if (existingItem) {
        existingItem.quantity += selectedQuantity;
    } else {
        cart.push({
            id: bookId,
            name: product.name,
            price: product.price,
            quantity: selectedQuantity,
        });
    }

    quantityState[bookId] = 1;
    paypalSuccessNote.hidden = true;
    syncQuantityDisplays();
    renderCart();
    showToast(`${product.name} added to your order.`);
}

function applyPromoCode() {
    const enteredCode = promoCodeInput.value.trim().toUpperCase();

    if (!enteredCode) {
        const hadPromoCode = Boolean(appliedPromoCode);

        appliedPromoCode = "";
        savePromoCode();
        syncPromoInput();
        renderCart();
        setPromoFeedback(
            hadPromoCode ? "Promo code removed." : "Enter a promo code to apply.",
            hadPromoCode ? "success" : "error",
        );

        if (hadPromoCode) {
            showToast("Promo code removed.");
        }

        return;
    }

    const promo = storefrontConfig.promoCodes[enteredCode];

    if (!promo) {
        setPromoFeedback("That promo code is not valid.", "error");
        showToast("Promo code not recognized.");
        return;
    }

    appliedPromoCode = promo.code;
    savePromoCode();
    syncPromoInput();
    paypalSuccessNote.hidden = true;
    renderCart();
    setPromoFeedback(`${promo.code} applied. ${promo.discountPercent}% off your order total.`, "success");
    showToast(`${promo.code} applied for ${promo.discountPercent}% off.`);
}

function removeFromCart(bookId) {
    cart = cart.filter((item) => item.id !== bookId);
    renderCart();
}

function setActiveTab(tabId, options = {}) {
    const { updateHash = true, scrollToTop = true } = options;
    const targetPanel = document.querySelector(`[data-tab-panel="${tabId}"]`);

    if (!targetPanel) {
        return;
    }

    tabPanels.forEach((panel) => {
        panel.classList.toggle("isActive", panel === targetPanel);
    });

    navLinks.forEach((link) => {
        const active = link.dataset.tabTarget === tabId;
        link.classList.toggle("isActive", active);
        if (active) link.setAttribute("aria-current", "page");
        else link.removeAttribute("aria-current");
    });

    document.body.classList.remove("navOpen");
    navToggle.setAttribute("aria-expanded", "false");

    if (updateHash && window.location.hash !== `#${tabId}`) {
        window.history.pushState(null, "", `#${tabId}`);
    }

    if (scrollToTop) {
        const heading = targetPanel.querySelector("h1, h2");
        heading?.setAttribute("tabindex", "-1");
        heading?.focus({ preventScroll: true });
        window.scrollTo({ top: 0, behavior: motionBehavior() });
    }
    updateOrderShortcut();
}

function activeTabFromHash() {
    const hash = window.location.hash.replace("#", "");
    return [...tabPanels].some((panel) => panel.dataset.tabPanel === hash) ? hash : "home";
}

function handleBookGridClick(event) {
    const clickedButton = event.target.closest("button");
    const bookCard = event.target.closest(".bookCard");

    if (!clickedButton || !bookCard) {
        return;
    }

    const bookId = bookCard.dataset.book;

    if (clickedButton.hasAttribute("data-qty-change")) {
        const change = Number(clickedButton.dataset.qtyChange);
        quantityState[bookId] = Math.max(1, quantityState[bookId] + change);
        syncQuantityDisplays();
        return;
    }

    if (clickedButton.hasAttribute("data-add-to-cart")) {
        addToCart(bookId);
    }
}

function handleCartClick(event) {
    const removeButton = event.target.closest("[data-remove-book]");

    if (!removeButton) {
        return;
    }

    removeFromCart(removeButton.dataset.removeBook);
}

function buildPayPalOrderPayload() {
    const subtotal = cartSubtotal();
    const discount = cartDiscount();

    currentOrderReference = buildOrderReference();
    syncOrderSummaryFields(currentOrderReference);

    return {
        intent: storefrontConfig.paypal.intent,
        purchase_units: [
            {
                reference_id: currentOrderReference,
                custom_id: currentOrderReference,
                description: "TAKE NOTE BIBLES order",
                amount: {
                    currency_code: storefrontConfig.paypal.currency,
                    value: cartTotal().toFixed(2),
                    breakdown: {
                        item_total: {
                            currency_code: storefrontConfig.paypal.currency,
                            value: subtotal.toFixed(2),
                        },
                        ...(discount > 0
                            ? {
                                  discount: {
                                      currency_code: storefrontConfig.paypal.currency,
                                      value: discount.toFixed(2),
                                  },
                              }
                            : {}),
                    },
                },
                items: cart.map((item) => ({
                    name: item.name,
                    quantity: String(item.quantity),
                    unit_amount: {
                        currency_code: storefrontConfig.paypal.currency,
                        value: item.price.toFixed(2),
                    },
                    category: "PHYSICAL_GOODS",
                })),
            },
        ],
    };
}

function submitPaidOrderEmail(approvalData, captureDetails) {
    const capture =
        captureDetails.purchase_units &&
        captureDetails.purchase_units[0] &&
        captureDetails.purchase_units[0].payments &&
        captureDetails.purchase_units[0].payments.captures &&
        captureDetails.purchase_units[0].payments.captures[0]
            ? captureDetails.purchase_units[0].payments.captures[0]
            : null;
    const payerName = [
        captureDetails.payer && captureDetails.payer.name
            ? captureDetails.payer.name.given_name
            : "",
        captureDetails.payer && captureDetails.payer.name
            ? captureDetails.payer.name.surname
            : "",
    ]
        .filter(Boolean)
        .join(" ");

    syncOrderSummaryFields(currentOrderReference);
    orderSubjectField.value = `PAID TAKE NOTE BIBLES order - ${formatCurrency(cartTotal())}`;
    orderNextField.value = currentReturnUrl();
    paymentProviderField.value = "PayPal";
    paymentStatusField.value = capture ? capture.status || "" : captureDetails.status || "";
    paypalOrderIdField.value = approvalData.orderID || captureDetails.id || "";
    paypalCaptureIdField.value = capture ? capture.id || "" : "";
    paypalPayerEmailField.value =
        captureDetails.payer && captureDetails.payer.email_address
            ? captureDetails.payer.email_address
            : "";
    paypalPayerNameField.value = payerName;

    orderForm.submit();
}

function resetCheckoutAfterPayment(captureId) {
    cart = [];
    appliedPromoCode = "";
    saveCart();
    savePromoCode();
    renderCart();
    clearPaymentFields();
    currentOrderReference = "";
    orderForm.reset();
    syncPromoInput();
    setPromoFeedback();
    orderNextField.value = currentReturnUrl();
    paypalSuccessNote.hidden = false;
    paypalSuccessNote.textContent = captureId
        ? `Payment completed. Order details were sent for fulfillment. PayPal capture ID: ${captureId}.`
        : "Payment completed. Order details were sent for fulfillment.";
    checkoutNote.textContent = "Your order was paid successfully through PayPal.";
    updatePayPalButtonState();
}

function handlePayPalApproval(approvalData, captureDetails) {
    const capture =
        captureDetails.purchase_units &&
        captureDetails.purchase_units[0] &&
        captureDetails.purchase_units[0].payments &&
        captureDetails.purchase_units[0].payments.captures &&
        captureDetails.purchase_units[0].payments.captures[0]
            ? captureDetails.purchase_units[0].payments.captures[0]
            : null;

    submitPaidOrderEmail(approvalData, captureDetails);
    window.setTimeout(() => {
        resetCheckoutAfterPayment(capture ? capture.id || "" : "");
    }, 200);
}

function initializePayPalCheckout() {
    if (!paypalIsConfigured()) {
        return;
    }

    loadPayPalSdk()
        .then((paypal) => {
            paypal.Buttons({
                style: {
                    layout: "vertical",
                    color: "gold",
                    shape: "pill",
                    label: "paypal",
                    tagline: false,
                },
                onInit(data, actions) {
                    paypalButtonActions = actions;
                    updatePayPalButtonState();
                },
                onClick(data, actions) {
                    paypalSuccessNote.hidden = true;

                    if (cart.length === 0) {
                        showToast("Add at least one book before paying.");
                        return actions.reject();
                    }

                    if (!orderForm.checkValidity()) {
                        orderForm.reportValidity();
                        showToast("Fill in your customer details before paying.");
                        return actions.reject();
                    }

                    return actions.resolve();
                },
                createOrder(data, actions) {
                    return actions.order.create(buildPayPalOrderPayload());
                },
                onApprove(data, actions) {
                    return actions.order.capture().then((captureDetails) => {
                        handlePayPalApproval(data, captureDetails);
                    });
                },
                onCancel() {
                    showToast("PayPal checkout was canceled.");
                },
                onError(error) {
                    console.error("PayPal checkout error:", error);
                    showToast("PayPal checkout could not be completed.");
                },
            }).render("#paypal-button-container");
        })
        .catch((error) => {
            console.error(error);
            paymentConfigNote.hidden = false;
            paymentConfigNote.textContent =
                "The PayPal checkout script could not be loaded. Double-check your client ID and internet connection.";
        });
}

function handleManualOrderSubmit(event) {
    event.preventDefault();
    showToast("Use the PayPal button below to complete payment.");
}

function initializeNav() {
    document.addEventListener("click", (event) => {
        const tabTrigger = event.target.closest("[data-tab-target]");

        if (!tabTrigger) {
            return;
        }

        event.preventDefault();
        setActiveTab(tabTrigger.dataset.tabTarget);
    });

    navToggle.addEventListener("click", () => {
        const isOpen = document.body.classList.toggle("navOpen");
        navToggle.setAttribute("aria-expanded", String(isOpen));
    });

    document.addEventListener("keydown", (event) => {
        if (event.key === "Escape" && document.body.classList.contains("navOpen")) {
            document.body.classList.remove("navOpen");
            navToggle.setAttribute("aria-expanded", "false");
            navToggle.focus();
        }
    });
    document.addEventListener("pointerdown", (event) => {
        if (!event.target.closest(".siteHeader")) {
            document.body.classList.remove("navOpen");
            navToggle.setAttribute("aria-expanded", "false");
        }
    });
    reviewOrder.addEventListener("click", () => {
        const summary = document.getElementById("cart-title");
        summary.focus({ preventScroll: true });
        summary.scrollIntoView({ behavior: motionBehavior(), block: "start" });
    });

    window.addEventListener("hashchange", () => {
        if (![...tabPanels].some((panel) => `#${panel.dataset.tabPanel}` === window.location.hash)) return;
        setActiveTab(activeTabFromHash(), {
            updateHash: false,
            scrollToTop: false,
        });
    });
}

document.addEventListener("DOMContentLoaded", () => {
    syncFormTargets();
    syncQuantityDisplays();
    clearPaymentFields();
    syncPromoInput();
    renderCart();
    updateCheckoutMessaging();
    initializeNav();
    initializePayPalCheckout();

    booksGrid.addEventListener("click", handleBookGridClick);
    cartItemsElement.addEventListener("click", handleCartClick);
    orderForm.addEventListener("submit", handleManualOrderSubmit);
    orderForm.addEventListener("input", updatePayPalButtonState);
    orderForm.addEventListener("change", updatePayPalButtonState);
    promoCodeInput.addEventListener("input", () => {
        setPromoFeedback();
    });
    promoCodeInput.addEventListener("keydown", (event) => {
        if (event.key !== "Enter") {
            return;
        }

        event.preventDefault();
        applyPromoCode();
    });
    applyPromoButton.addEventListener("click", applyPromoCode);

    setActiveTab(activeTabFromHash(), {
        updateHash: false,
        scrollToTop: false,
    });
});
