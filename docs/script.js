// Navigation scroll effect
window.addEventListener('scroll', function() {
    const navbar = document.querySelector('.navbar');
    if (window.scrollY > 50) {
        navbar.style.background = 'rgba(255, 255, 255, 0.98)';
        navbar.style.boxShadow = '0 2px 20px rgba(0, 0, 0, 0.1)';
    } else {
        navbar.style.background = 'rgba(255, 255, 255, 0.95)';
        navbar.style.boxShadow = 'none';
    }
});

// Mobile navigation toggle
const navToggle = document.querySelector('.nav-toggle');
const navLinks = document.querySelector('.nav-links');

navToggle?.addEventListener('click', function() {
    navLinks.style.display = navLinks.style.display === 'flex' ? 'none' : 'flex';
});

// Tab functionality for Quick Start
document.addEventListener('DOMContentLoaded', function() {
    // Quick Start tabs
    const tabButtons = document.querySelectorAll('.tab-button');
    const tabContents = document.querySelectorAll('.tab-content');
    
    tabButtons.forEach(button => {
        button.addEventListener('click', function() {
            const targetTab = this.getAttribute('data-tab');
            
            // Remove active class from all buttons and contents
            tabButtons.forEach(btn => btn.classList.remove('active'));
            tabContents.forEach(content => content.classList.remove('active'));
            
            // Add active class to clicked button and corresponding content
            this.classList.add('active');
            document.getElementById(targetTab).classList.add('active');
        });
    });
    
    // Platform tabs
    const platformButtons = document.querySelectorAll('.platform-btn');
    const platformContents = document.querySelectorAll('.platform-content');
    
    platformButtons.forEach(button => {
        button.addEventListener('click', function() {
            const targetPlatform = this.getAttribute('data-platform');
            
            // Remove active class from all platform buttons and contents
            platformButtons.forEach(btn => btn.classList.remove('active'));
            platformContents.forEach(content => content.classList.remove('active'));
            
            // Add active class to clicked button and corresponding content
            this.classList.add('active');
            document.getElementById(targetPlatform).classList.add('active');
        });
    });
});

// Copy code functionality
function copyCode(button) {
    const codeBlock = button.parentElement;
    const code = codeBlock.querySelector('code');
    const text = code.textContent;
    
    // Create temporary textarea to copy text
    const textarea = document.createElement('textarea');
    textarea.value = text;
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    document.body.removeChild(textarea);
    
    // Update button text
    const originalText = button.textContent;
    button.textContent = 'Copied!';
    button.style.background = '#10b981';
    
    setTimeout(() => {
        button.textContent = originalText;
        button.style.background = '#3b82f6';
    }, 2000);
}

// Smooth scrolling for anchor links
document.querySelectorAll('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', function (e) {
        e.preventDefault();
        const targetId = this.getAttribute('href');
        const targetElement = document.querySelector(targetId);
        
        if (targetElement) {
            const offsetTop = targetElement.offsetTop - 80; // Account for fixed navbar
            window.scrollTo({
                top: offsetTop,
                behavior: 'smooth'
            });
        }
    });
});

// Intersection Observer for animations
const observerOptions = {
    threshold: 0.1,
    rootMargin: '0px 0px -50px 0px'
};

const observer = new IntersectionObserver(function(entries) {
    entries.forEach(entry => {
        if (entry.isIntersecting) {
            entry.target.style.opacity = '1';
            entry.target.style.transform = 'translateY(0)';
        }
    });
}, observerOptions);

// Observe elements for animation
document.addEventListener('DOMContentLoaded', function() {
    const animatedElements = document.querySelectorAll('.feature-card, .example-card, .use-case, .benefit, .step');
    
    animatedElements.forEach(el => {
        el.style.opacity = '0';
        el.style.transform = 'translateY(30px)';
        el.style.transition = 'opacity 0.6s ease-out, transform 0.6s ease-out';
        observer.observe(el);
    });
});

// GitHub stars counter (optional - requires GitHub API)
async function fetchGitHubStars() {
    try {
        const response = await fetch('https://api.github.com/repos/brookesdjb/browser-pilot');
        const data = await response.json();
        const stars = data.stargazers_count;
        
        // Update any star counters on the page
        const starElements = document.querySelectorAll('.github-stars');
        starElements.forEach(el => {
            el.textContent = `⭐ ${stars}`;
        });
    } catch (error) {
        console.log('Could not fetch GitHub stars:', error);
    }
}

// Call on page load
document.addEventListener('DOMContentLoaded', fetchGitHubStars);

// Resize handler for responsive architecture diagram
function adjustArchitectureDiagram() {
    const diagram = document.querySelector('.diagram-container');
    const connections = document.querySelectorAll('.connection-line');
    
    if (window.innerWidth <= 768) {
        // Mobile layout - vertical connections
        connections.forEach(line => {
            if (!line.classList.contains('multi')) {
                line.style.width = '2px';
                line.style.height = '40px';
                line.style.transform = 'rotate(90deg)';
            }
        });
    } else {
        // Desktop layout - horizontal connections
        connections.forEach(line => {
            if (!line.classList.contains('multi')) {
                line.style.width = '60px';
                line.style.height = '2px';
                line.style.transform = 'none';
            }
        });
    }
}

// Call on load and resize
window.addEventListener('load', adjustArchitectureDiagram);
window.addEventListener('resize', adjustArchitectureDiagram);

// Add loading animation
window.addEventListener('load', function() {
    document.body.style.opacity = '1';
});

// Initial page load fade in
document.body.style.opacity = '0';
document.body.style.transition = 'opacity 0.3s ease-in';

// Form validation for any future contact forms
function validateEmail(email) {
    const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return re.test(email);
}

// Dark mode toggle (future feature)
function toggleDarkMode() {
    document.body.classList.toggle('dark-mode');
    localStorage.setItem('darkMode', document.body.classList.contains('dark-mode'));
}

// Load dark mode preference
document.addEventListener('DOMContentLoaded', function() {
    if (localStorage.getItem('darkMode') === 'true') {
        document.body.classList.add('dark-mode');
    }
});

// Preload important images
function preloadImages() {
    const imageUrls = [
        // Add any important images here
    ];
    
    imageUrls.forEach(url => {
        const img = new Image();
        img.src = url;
    });
}

document.addEventListener('DOMContentLoaded', preloadImages);