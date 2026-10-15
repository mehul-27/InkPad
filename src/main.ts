import "@fontsource-variable/ibm-plex-sans";
import "@fontsource-variable/ibm-plex-sans/wght-italic.css";
import "@fontsource-variable/jetbrains-mono";
import "@fontsource-variable/newsreader";
import { mount } from "svelte";
import App from "./App.svelte";
import "./app.css";

mount(App, { target: document.getElementById("app")! });
