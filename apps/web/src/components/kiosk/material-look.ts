// A simple picture and the translated name for each material. A material added to the seed
// file later still works: it gets a plain box and its own name.
import {
  Box,
  BrickWall,
  Cylinder,
  FlaskConical,
  Hexagon,
  Mountain,
  Package,
  Recycle,
  Rows3,
  Shapes,
  type LucideIcon,
} from "lucide-react";
import { DICTIONARIES, type MessageKey, type Translate } from "@/i18n/translate";

const ICONS: Record<string, LucideIcon> = {
  "cement-bags": Package,
  additive: FlaskConical,
  bitumen: Cylinder,
  "steel-bars": Rows3,
  "steel-scrap": Recycle,
  "aggregate-20-mm": Hexagon,
  "aggregate-10-mm": Shapes,
  sand: Mountain,
  bricks: BrickWall,
};

const slug = (name: string) => name.toLowerCase().replace(/\s+/g, "-");

export const materialIcon = (name: string): LucideIcon => ICONS[slug(name)] ?? Box;

export function materialLabel(t: Translate, name: string): string {
  const key = `material.${slug(name)}`;
  return Object.hasOwn(DICTIONARIES.en, key) ? t(key as MessageKey) : name;
}
