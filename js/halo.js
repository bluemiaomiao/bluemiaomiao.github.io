function autoChangeIndexDonors() {
    const currentLangEnvTag = document.getElementById("current-lang-env")
    if (currentLangEnvTag) {
        let lang =  "en-US";
        if (navigator.language) {
            lang = navigator.language
        } else {
            if (navigator.userLanguage) {
                lang = navigator.userLanguage
            }
        }

        if (lang.startsWith("zh")) {
            currentLangEnvTag.innerText = "本站点由 WecomZ 赞助支持。";
        } else {
            currentLangEnvTag.innerText = "This site is sponsored and supported by WecomZ.";
        }
    }
}

function main() {
    autoChangeIndexDonors()
}

main()