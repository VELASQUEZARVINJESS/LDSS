// For more details see: https://getbootstrap.com/docs/5.0/components/toasts/#usage

window.addEventListener("DOMContentLoaded", function () {
    if (!window.bootstrap || typeof window.bootstrap.Toast !== "function") {
        return;
    }

    const toastBasicEl = document.getElementById("toastBasic");
    const toastNoAutohideEl = document.getElementById("toastNoAutohide");
    const toastBasic = toastBasicEl ? new window.bootstrap.Toast(toastBasicEl) : null;
    const toastNoAutohide = toastNoAutohideEl ? new window.bootstrap.Toast(toastNoAutohideEl) : null;

    const toastBasicTrigger = document.getElementById("toastBasicTrigger");
    if (toastBasicTrigger && toastBasic) {
        toastBasicTrigger.addEventListener("click", function () {
            toastBasic.show();
        });
    }

    const toastNoAutohideTrigger = document.getElementById("toastNoAutohideTrigger");
    if (toastNoAutohideTrigger && toastNoAutohide) {
        toastNoAutohideTrigger.addEventListener("click", function () {
            toastNoAutohide.show();
        });
    }
});
