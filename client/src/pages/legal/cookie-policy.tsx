

export default function CookiePolicy() {
  return (
    <div className="container max-w-6xl mx-auto py-8 px-4">
      <div className="space-y-1 mb-6">
        <h1 className="text-3xl font-bold">Cookie Policy</h1>
      </div>

      <div className="space-y-8 prose prose-invert max-w-none">
        <section className="space-y-3">
          <h2 className="text-2xl font-semibold">What Are Cookies</h2>
          <p className="text-muted-foreground">Cookies are small text files that are stored on your computer or mobile device when you visit a website. They allow the website to recognize your device and remember if you've been to the website before.</p>
        </section>

        <section className="space-y-3">
          <h2 className="text-2xl font-semibold">How We Use Cookies</h2>
          <p className="text-muted-foreground">We use cookies to enhance your experience on our website, including:</p>
          <ul className="list-disc pl-6 space-y-2 text-muted-foreground">
            <li>Remembering your preferences and settings</li>
            <li>Keeping you signed in</li>
            <li>Understanding how you use our website</li>
            <li>Improving our content and functionality</li>
          </ul>
        </section>

        <section className="space-y-3">
          <h2 className="text-2xl font-semibold">Types of Cookies We Use</h2>
          <ul className="list-disc pl-6 space-y-2 text-muted-foreground">
            <li><strong>Essential cookies:</strong> Required for the website to function properly</li>
            <li><strong>Functionality cookies:</strong> Remember choices you make to improve your experience</li>
            <li><strong>Analytics cookies:</strong> Help us understand how visitors interact with our website</li>
            <li><strong>Performance cookies:</strong> Collect information about how you use our website</li>
          </ul>
        </section>

        <section className="space-y-3">
          <h2 className="text-2xl font-semibold">Managing Cookies</h2>
          <p className="text-muted-foreground">Most web browsers allow you to control cookies through their settings. You can usually find these settings in the "options" or "preferences" menu of your browser.</p>
          <p className="text-muted-foreground">Please note that if you choose to disable cookies, some features of our website may not function properly.</p>
        </section>

        <section className="space-y-3">
          <h2 className="text-2xl font-semibold">Changes to This Cookie Policy</h2>
          <p className="text-muted-foreground">We may update our Cookie Policy from time to time. We will notify you of any changes by posting the new Cookie Policy on this page.</p>
        </section>
      </div>
    </div>
  );
}