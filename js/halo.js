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

function smartRedirect() {
    const host = window.location.host;
    const href = window.location.href;
    const origin = window.location.origin;

    if (host.startsWith("localhost") || host.startsWith("127.0.0.1")) {
        console.log("Debug mode, smart redirect is disabled.")
        return
    }

    geoip2.country((response) => {
        if (!response.country.iso_code) {
            return
        }

        const code = response.country.iso_code.toLowerCase();

        if (code === "cn") {
            if (!host.startsWith("bluemiaomiao.gitee.io")) {
                const newHref = href.replace(origin, "https://bluemiaomiao.gitee.io")
                window.location.replace(newHref)
                console.info("您当前的区域位置为中国，Halo的跳转目的是为了加速访问。")
            }
        } else {
            if (!host.startsWith("bluemiaomiao.github.io")) {
                const newHref = href.replace(origin, "https://bluemiaomiao.github.io")
                window.location.replace(newHref)
                console.info("Your location is " + code + ", the purpose of Halo's jump is to accelerate access.")   
            }
        }

    }, (error) => {
        console.error(error)
    }, {})
}

function main() {
    autoChangeIndexDonors()
    smartRedirect()
}

main()