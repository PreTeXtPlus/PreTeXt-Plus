import React from 'react';
import ReactDOM from "react-dom/client";
import { Editors } from '@pretextbook/web-editor';
import '@pretextbook/web-editor/dist/web-editor.css';

let root = null;

function render(node, props) {
  root = ReactDOM.createRoot(node);
  root.render(<Editors {...props} />);
}

function destroy() {
  root.unmount();
}

export { destroy, render };
