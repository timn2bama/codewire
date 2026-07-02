import type { LucideIcon } from "lucide-react";
import { Activity, Cable, Box, Spline, Gauge } from "lucide-react";

export interface CalculatorMeta {
  id: string;
  title: string;
  path: string;
  blurb: string;
  /** NEC reference shown as a chip. */
  code: string;
  icon: LucideIcon;
  /** Search terms so "conduit fill" etc. land directly. */
  keywords: string[];
}

export const CALCULATORS: CalculatorMeta[] = [
  {
    id: "voltage-drop",
    title: "Voltage Drop",
    path: "/voltage-drop",
    blurb: "% drop and wire size for a run length",
    code: "210.19 / Ch.9",
    icon: Activity,
    keywords: ["voltage drop", "vd", "wire size", "dc voltage drop", "percent"],
  },
  {
    id: "conduit-fill",
    title: "Conduit Fill",
    path: "/conduit-fill",
    blurb: "Will the wires fit the pipe?",
    code: "Ch.9 Tbl 1, 4, 5",
    icon: Cable,
    keywords: ["conduit fill", "raceway", "emt", "pvc", "southwire", "pipe fill"],
  },
  {
    id: "ampacity",
    title: "Wire Ampacity",
    path: "/ampacity",
    blurb: "Derated ampacity & minimum wire size",
    code: "310.16 / 310.15",
    icon: Gauge,
    keywords: ["ampacity", "wire size", "derate", "ampere", "conductor sizing"],
  },
  {
    id: "box-fill",
    title: "Box Fill",
    path: "/box-fill",
    blurb: "Cubic inches required vs box volume",
    code: "314.16",
    icon: Box,
    keywords: ["box fill", "junction box", "device box", "cubic inch"],
  },
  {
    id: "conduit-bending",
    title: "Conduit Bending",
    path: "/conduit-bending",
    blurb: "Offsets, saddles & 90° stub-ups",
    code: "Geometry",
    icon: Spline,
    keywords: ["bending", "offset", "saddle", "stub", "90", "multiplier"],
  },
];
