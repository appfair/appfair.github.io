---
name: AppFair
title: The App Fair
---

# The App Fair, Live!


<!-- Add a placeholder for the Twitch embed -->
<div id="twitch-embed"></div>

<!-- Load the Twitch embed JavaScript file -->
<script src="https://embed.twitch.tv/embed/v1.js"></script>

<!-- Create a Twitch.Embed object that will render within the "twitch-embed" element -->
<script type="text/javascript">
  new Twitch.Embed("twitch-embed", {
    channel: "appfair",
    width: 854,
    height: 480,
    autoplay: false,
    muted: false,
    theme: "light",
    layout: "video",
    parent: ["appfair.net", "www.appfair.net"]
  });
</script>


