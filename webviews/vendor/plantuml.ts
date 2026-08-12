// A separate PlantUML bundle, loaded together with viz-global on demand.
import { renderToString } from "@plantuml/core";

(window as unknown as { __plantuml: unknown }).__plantuml = { renderToString };
