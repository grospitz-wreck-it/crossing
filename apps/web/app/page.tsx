import Image from "next/image";
import Link from "next/link";
import styles from "./LandingPage.module.css";

const features = [
  { number: "01", icon: "↗", title: "Prognosen", text: "Erkenne frühzeitig, wann die Schranke voraussichtlich schließt und wieder öffnet." },
  { number: "02", icon: "◇", title: "Deine Schranken", text: "Speichere die Bahnübergänge, die für deinen Alltag wirklich wichtig sind." },
  { number: "03", icon: "◌", title: "Live", text: "Aktuelle Informationen und Prognosen direkt auf deinem Smartphone." },
];

const faqs = [
  {
    question: "Ist MeineSchranke kostenlos?",
    answer: "Die erste Schranke soll kostenlos sein. Weitere Bahnübergänge können aber hinzugebucht werden, wenn das Angebot ausgebaut wird.",
  },
  {
    question: "Wie genau sind die