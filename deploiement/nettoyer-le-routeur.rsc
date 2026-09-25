# ============================================================
#  GeMikrot - RETIRER TOUTE TRACE DE LA PLATEFORME DE CE ROUTEUR
#
#  A coller dans le terminal Winbox, ligne par ligne ou d'un bloc.
#
#  ATTENTION - A NE FAIRE QUE BRANCHE SUR LE RESEAU DU ROUTEUR.
#  La derniere etape detruit l'interface WireGuard, donc la cle privee,
#  donc le tunnel. Apres cela le serveur ne peut plus joindre ce routeur :
#  le seul moyen de revenir est de coller un nouveau script d'enrolement
#  depuis Winbox, en local. Lance a distance, ce script coupe la branche
#  sur laquelle il est assis.
#
#  Ce qu'il NE touche PAS : votre compte admin, vos clients, vos comptes
#  HotSpot, votre User Manager, votre configuration WiFi. Uniquement ce
#  que l'enrolement GeMikrot avait pose.
#
#  Chaque ligne est enveloppee de << :do { } on-error={} >> : elle passe
#  sans bruit si l'element n'existe pas. Le script est donc rejouable, et
#  ne s'arrete pas au milieu parce qu'une etape avait deja ete faite.
# ============================================================

# 1. L'exception qui faisait sortir la console du portail captif.
:do { /ip/hotspot/ip-binding/remove [find comment="GeMikrot - console"] } on-error={}

# 2. La regle de pare-feu qui ouvrait le port du tunnel en entree.
:do { /ip/firewall/filter/remove [find comment="GeMikrot - tunnel"] } on-error={}

# 3. Le serveur comme pair.
:do { /interface/wireguard/peers/remove [find comment="GeMikrot"] } on-error={}

# 4. La route vers le sous-reseau du tunnel.
:do { /ip/route/remove [find comment="GeMikrot"] } on-error={}

# 5. L'adresse du routeur dans le tunnel.
:do { /ip/address/remove [find interface=gemikrot] } on-error={}

# 6. Le compte applicatif, puis son groupe.
#
#    Dans cet ordre : RouterOS refuse de retirer un groupe dont un
#    utilisateur depend encore.
:do { /user/remove [find name="gemikrot-api"] } on-error={}
:do { /user/group/remove [find name=gemikrot] } on-error={}

# 7. Le certificat de l'API.
#
#    On le detache de << www-ssl >> AVANT de le retirer : un certificat
#    en service ne peut pas etre supprime, et la commande echouerait sans
#    que rien ne le dise clairement.
:do { /ip/service set www-ssl certificate=none } on-error={}
:do { /ip/service set www-ssl disabled=yes } on-error={}
:do { /certificate remove [find name="gemikrot-api-cert"] } on-error={}
:do { /certificate remove [find name="gemikrot-ca"] } on-error={}

# 8. Le nom public demande a MikroTik.
#
#    Il ne sert plus a rien depuis que c'est le routeur qui appelle le
#    serveur, mais on le rend a son etat d'origine.
:do { /ip/cloud set ddns-enabled=no } on-error={}

# 9. L'interface WireGuard - et avec elle la cle privee.
#
#    **C'est ici que le tunnel meurt.** Rien de ce routeur ne permettra
#    de le remonter : la cle privee n'existait qu'ici et n'a jamais ete
#    copiee ailleurs, ce qui est exactement la propriete recherchee.
#    Un nouveau script d'enrolement en fabriquera une autre.
:do { /interface/wireguard/remove [find name=gemikrot] } on-error={}

:put "Nettoyage termine. Ce routeur ne connait plus GeMikrot."

# ── Verification ────────────────────────────────────────────
#
# Les trois commandes ci-dessous doivent ne rien afficher. Si l'une rend
# une ligne, l'element correspondant est reste : relancez la ligne qui
# le concerne ci-dessus.
/interface/wireguard/print where name=gemikrot
/user/print where name="gemikrot-api"
/certificate/print where name~"gemikrot"
