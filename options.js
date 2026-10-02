const input = document.getElementById("token");
const status = document.getElementById("status");

chrome.storage.local.get({ token: "" }, (v) => (input.value = v.token));
document.getElementById("save").addEventListener("click", () => {
  chrome.storage.local.set({ token: input.value.trim() }, () => {
    status.textContent = "Saved";
    setTimeout(() => (status.textContent = ""), 1500);
  });
});
