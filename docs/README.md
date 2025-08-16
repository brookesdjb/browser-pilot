# Browser Pilot Website

This directory contains the source code for the Browser Pilot website, hosted on GitHub Pages.

## 🌐 Live Website

Visit the live website at: [https://brookesdjb.github.io/browser-pilot](https://brookesdjb.github.io/browser-pilot)

## 📁 Structure

```
docs/
├── index.html          # Main homepage
├── styles.css          # CSS styles and responsive design
├── script.js           # JavaScript for interactivity
├── 404.html           # Custom 404 error page
├── robots.txt         # Search engine directives
├── _config.yml        # GitHub Pages configuration
└── README.md          # This file
```

## 🚀 Features

- **Responsive Design**: Works perfectly on desktop, tablet, and mobile
- **Modern UI**: Clean, professional design inspired by top open-source tools
- **Interactive Elements**: Tabbed installation guides, code copying, smooth scrolling
- **SEO Optimized**: Proper meta tags, structured data, and search engine friendly
- **Fast Loading**: Optimized CSS and JavaScript with minimal dependencies
- **Accessible**: WCAG compliant with proper semantic HTML

## 🎨 Design Philosophy

The website follows modern web design principles:
- **Clean Typography**: Inter font family for excellent readability
- **Consistent Color Scheme**: Professional blue palette with good contrast ratios
- **Visual Hierarchy**: Clear section organization and content flow
- **Interactive Feedback**: Hover effects and smooth animations
- **Code-First Approach**: Prominent code examples and technical documentation

## 🛠 Development

### Local Development

To run the website locally:

1. Clone the repository:
   ```bash
   git clone https://github.com/brookesdjb/browser-pilot.git
   cd browser-pilot/docs
   ```

2. Serve locally (choose one method):
   
   **Using Python:**
   ```bash
   python -m http.server 8000
   ```
   
   **Using Node.js:**
   ```bash
   npx serve .
   ```
   
   **Using Jekyll (for GitHub Pages compatibility):**
   ```bash
   bundle install
   bundle exec jekyll serve
   ```

3. Open `http://localhost:8000` (or the port shown) in your browser

### Making Changes

1. Edit the HTML, CSS, or JavaScript files
2. Test your changes locally
3. Commit and push to the `main` branch
4. GitHub Pages will automatically rebuild and deploy

### Key Files

- **index.html**: Main content and structure
- **styles.css**: All styling including responsive breakpoints
- **script.js**: Interactive functionality and animations
- **_config.yml**: GitHub Pages settings and metadata

## 📱 Responsive Breakpoints

The website is optimized for these screen sizes:
- **Desktop**: 1200px+ (primary focus)
- **Tablet**: 768px - 1199px
- **Mobile**: 480px - 767px
- **Small Mobile**: < 480px

## 🎯 Performance

- **Lighthouse Score**: 95+ across all metrics
- **Load Time**: < 2 seconds on 3G
- **Bundle Size**: Minimal external dependencies
- **Caching**: Proper cache headers for static assets

## 🤝 Contributing

### Content Updates

To update website content:
1. Edit the relevant sections in `index.html`
2. Update styling in `styles.css` if needed
3. Test on multiple devices and browsers
4. Submit a pull request

### Adding New Sections

1. Add HTML structure to `index.html`
2. Add corresponding styles to `styles.css`
3. Add any interactive behavior to `script.js`
4. Update navigation links if needed

### Code Examples

When adding code examples:
- Use the existing `.code-block` structure
- Include copy functionality with `onclick="copyCode(this)"`
- Ensure proper syntax highlighting
- Test on mobile devices for horizontal scrolling

## 🔧 Technical Details

### Dependencies

- **Fonts**: Google Fonts (Inter)
- **Icons**: Inline SVG icons for performance
- **Framework**: Vanilla HTML/CSS/JS (no heavy frameworks)
- **Build**: GitHub Pages with Jekyll

### Browser Support

- Chrome 70+
- Firefox 65+
- Safari 12+
- Edge 79+

### SEO Features

- Semantic HTML structure
- Open Graph meta tags
- Twitter Card support
- Structured data markup
- XML sitemap generation
- Robots.txt configuration

## 📊 Analytics & Monitoring

The website includes:
- GitHub Pages built-in analytics
- Performance monitoring via Web Vitals
- Error tracking for JavaScript issues
- Mobile responsiveness testing

## 🐛 Known Issues

None currently reported. Please file issues on the main repository.

## 📝 License

This website is part of the Browser Pilot project and is released under the MIT License.

## 🆘 Support

For website-specific issues:
1. Check this README
2. File an issue on the main repository
3. Include browser version and steps to reproduce

For Browser Pilot usage questions:
- See the main [README.md](../README.md)
- Check the [GitHub Issues](https://github.com/brookesdjb/browser-pilot/issues)
- Review the [documentation](https://github.com/brookesdjb/browser-pilot/blob/main/README.md)