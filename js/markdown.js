var postEditorElement = document.getElementById("postEditor");

if (window.EasyMDE && postEditorElement) {
    window.ldssPostEditor = new EasyMDE({
        element: postEditorElement,
        toolbar: ["bold", "italic", "heading", "|", "quote", "unordered-list", "ordered-list", "|", "link", "image", "|", "preview", "guide"]
    });
}
