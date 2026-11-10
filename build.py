#!/usr/bin/env python3
"""src/ の3ファイルを1枚の index.html にまとめる。使い方: python3 build.py"""
import os
D = os.path.dirname(os.path.abspath(__file__))
def rd(n):
    with open(os.path.join(D, "src", n), encoding="utf-8") as f:
        return f.read()
html = rd("page.html").replace("/*__ENGINE__*/", rd("engine.js")).replace("/*__UI__*/", rd("ui.js"))
with open(os.path.join(D, "index.html"), "w", encoding="utf-8") as f:
    f.write(html)
print("index.html", len(html), "bytes")
