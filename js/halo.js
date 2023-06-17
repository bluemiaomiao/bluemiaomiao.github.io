function getCurrentAppLanguage() {
    const lang = navigator.language || navigator.userLanguage;
    if (lang) {
        return lang
    } else {
        return "en-US"
    }
}

function main() {
    const lang = getCurrentAppLanguage()
    
    const currentLangEnvTag = document.getElementById("current-lang-env")
    
    if (lang.startsWith("zh")) {
        currentLangEnvTag.innerText = "语言环境：" + lang + ", 本站点由 WecomZ 赞助支持。";
    } else if (lang.startsWith("en")) {
        currentLangEnvTag.innerText = "Current language environment: " + lang + ", this site is sponsored and supported by WecomZ.";
    } else {
        currentLangEnvTag.innerText = "Warning: Can not supported browser language environment, use default: " + lang + ", this site is sponsored and supported by WecomZ.";
    }
}

main()