export default function LoadingScreen() {
  return (
    <main className="loadingScreen">

      <div className="loadingOverlay" />

      <img
        src="/images/meineschranke_logo.webp"
        alt="Meine Schranke"
        className="loadingLogo"
      />

      <div className="loadingBar">
        <div className="loadingBarFill" />
      </div>

    </main>
  );
}