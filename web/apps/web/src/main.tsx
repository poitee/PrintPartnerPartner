import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import { ThemeProvider } from "./context/ThemeContext";
import { DateFormatProvider } from "./context/DateFormatContext";
import "./index.css";
import "./App.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ThemeProvider>
      <DateFormatProvider>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </DateFormatProvider>
    </ThemeProvider>
  </React.StrictMode>,
);
