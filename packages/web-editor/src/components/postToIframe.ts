export const postToIframe = (url: string, data: any, iframeName: string) => {
  const form = document.createElement("form");
  form.method = "POST";
  form.action = url;
  form.target = iframeName;
  form.style.display = "none";

  for (const key in data) {
    if (Object.hasOwnProperty.call(data, key)) {
      const input = document.createElement("input");
      input.type = "hidden";
      input.name = key;
      input.value = data[key];
      form.appendChild(input);
    }
  }

  document.body.appendChild(form);
  form.submit();
  form.remove();
};
