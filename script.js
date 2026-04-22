// PayPal funds settle into the account tied to the client ID below.
// Paste your live PayPal REST app client ID before publishing.
const storefrontConfig = {
    orderEmail: "admin@takenotebibles.com",
    paypal: {
        clientId: "AbQCzoYIbysAc4zkiX7T5hHgfdvK6KeKw5pKDpW1UUYZlzZU9_uu0zvCe4HwmWbSdyIdgf5o3L837Ixq",
        currency: "USD",
        intent: "CAPTURE",
        enableFunding: ["venmo", "paylater", "card"],
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
const quantityState = Object.fromEntries(
    Object.keys(storefrontConfig.products).map((bookId) => [bookId, 1]),
);

let cart = loadCart();
let toastTimeout = 0;
let paypalScriptPromise = null;
let paypalButtonActions = null;
let currentOrderReference = "";

const navToggle = document.querySelector(".navToggle");
const navLinks = document.querySelectorAll(".navLink");
const tabPanels = document.querySelectorAll("[data-tab-panel]");
const booksGrid = document.querySelector(".booksGrid");
const cartItemsElement = document.getElementById("cart-items");
const cartTotalElement = document.getElementById("cart-total");
const orderForm = document.getElementById("order-form");
const contactForm = document.getElementById("contact-form");
const orderSubjectField = document.getElementById("order-subject");
const orderNextField = document.getElementById("order-next");
const orderSummaryField = document.getElementById("order-summary");
const orderTotalField = document.getElementById("order-total-field");
const orderReferenceField = document.getElementById("order-reference-field");
const paymentProviderField = document.getElementById("payment-provider-field");
const paymentStatusField = document.getElementById("payment-status-field");
const paypalOrderIdField = document.getElementById("paypal-order-id-field");
const paypalCaptureIdField = document.getElementById("paypal-capture-id-field");
const paypalPayerEmailField = document.getElementById("paypal-payer-email-field");
const paypalPayerNameField = document.getElementById("paypal-payer-name-field");
const checkoutNote = document.getElementById("checkout-note");
const paymentConfigNote = document.getElementById("payment-config-note");
const paypalSuccessNote = document.getElementById("paypal-success-note");
const paypalButtonContainer = document.getElementById("paypal-button-container");
const contactEmailLink = document.getElementById("contact-email");
const toast = document.getElementById("toast");

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

function formatCurrency(value) {
    return new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: storefrontConfig.paypal.currency,
    }).format(value);
}

function cartTotal() {
    return cart.reduce((total, item) => total + item.price * item.quantity, 0);
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
        }
    });
}

function clearPaymentFields() {
    orderReferenceField.value = "";
    paymentProviderField.value = "";
    paymentStatusField.value = "";
    paypalOrderIdField.value = "";
    paypalCaptureIdField.value = "";
    paypalPayerEmailField.value = "";
    paypalPayerNameField.value = "";
}

function syncOrderSummaryFields(reference = "") {
    const total = cartTotal();
    orderSummaryField.value = cart
        .map((item) => `${item.name} x${item.quantity} - ${formatCurrency(item.price * item.quantity)}`)
        .join("\n");
    orderTotalField.value = formatCurrency(total);
    orderReferenceField.value = reference;
}

function renderCart() {
    if (cart.length === 0) {
        cartItemsElement.innerHTML = '<p class="emptyState">Your cart is empty.</p>';
        cartTotalElement.textContent = formatCurrency(0);
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
                    <button type="button" class="removeButton" data-remove-book="${item.id}">Remove</button>
                </div>
            `;
        })
        .join("");

    cartItemsElement.innerHTML = html;
    cartTotalElement.textContent = formatCurrency(cartTotal());
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
        link.classList.toggle("isActive", link.dataset.tabTarget === tabId);
    });

    document.body.classList.remove("navOpen");
    navToggle.setAttribute("aria-expanded", "false");

    if (updateHash && window.location.hash !== `#${tabId}`) {
        window.history.replaceState(null, "", `#${tabId}`);
    }

    if (scrollToTop) {
        window.scrollTo({ top: 0, behavior: "smooth" });
    }
}

function activeTabFromHash() {
    const hash = window.location.hash.replace("#", "");
    return document.querySelector(`[data-tab-panel="${hash}"]`) ? hash : "home";
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
                            value: cartTotal().toFixed(2),
                        },
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
    saveCart();
    renderCart();
    clearPaymentFields();
    currentOrderReference = "";
    orderForm.reset();
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

    window.addEventListener("hashchange", () => {
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
    renderCart();
    updateCheckoutMessaging();
    initializeNav();
    initializePayPalCheckout();

    booksGrid.addEventListener("click", handleBookGridClick);
    cartItemsElement.addEventListener("click", handleCartClick);
    orderForm.addEventListener("submit", handleManualOrderSubmit);
    orderForm.addEventListener("input", updatePayPalButtonState);
    orderForm.addEventListener("change", updatePayPalButtonState);

    setActiveTab(activeTabFromHash(), {
        updateHash: false,
        scrollToTop: false,
    });
});
