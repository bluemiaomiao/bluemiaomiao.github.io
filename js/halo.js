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
        currentLangEnvTag.innerText = "当前浏览器语言环境：" + lang;
    } else if (lang.startsWith("en")) {
        currentLangEnvTag.innerText = "Current browser language environment: " + lang;
    } else {
        currentLangEnvTag.innerText = "Warning: Can not supported browser language environment, use default: " + lang;
    }
}

main()