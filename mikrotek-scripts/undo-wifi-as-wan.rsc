# RouterOS v7 script: undo Wi-Fi as WAN and restore WiFi radios to AP mode.
# This targets the newer /interface wifi package, usually wifi1 and wifi2.

:local apSsid "MikroTik-B43298"
:local apPassword "E3MY22FUU6"
:local wifiInterfaces {"wifi1";"wifi2"}
:local bridgeName "bridge"
:local natComment "wifi-as-wan masquerade"
:local dhcpCommentPrefix "wifi-as-wan dhcp client"

:put "Undoing Wi-Fi as WAN configuration"

:foreach wifiInterface in=$wifiInterfaces do={
    :if ([:len [/interface wifi find name=$wifiInterface]] = 0) do={
        :put ("Skipping missing WiFi interface " . $wifiInterface)
    } else={
        :put ("Restoring " . $wifiInterface . " to AP mode")

        :foreach dhcpClient in=[/ip dhcp-client find interface=$wifiInterface] do={
            /ip dhcp-client remove $dhcpClient
        }

        :foreach wanMember in=[/interface list member find list="WAN" interface=$wifiInterface] do={
            /interface list member remove $wanMember
        }

        :foreach staleRoute in=[/ip route find dst-address="0.0.0.0/0" gateway=$wifiInterface dynamic=no] do={
            /ip route remove $staleRoute
        }

        /interface wifi set [find name=$wifiInterface] \
            configuration.mode=ap \
            configuration.ssid=$apSsid \
            security.authentication-types=wpa2-psk,wpa3-psk \
            security.ft=yes \
            security.ft-over-ds=yes \
            security.passphrase=$apPassword \
            disabled=no

        :if ([:len [/interface bridge port find interface=$wifiInterface]] = 0) do={
            /interface bridge port add bridge=$bridgeName interface=$wifiInterface
        }
    }
}

:foreach natRule in=[/ip firewall nat find comment=$natComment] do={
    /ip firewall nat remove $natRule
}

:put "Wi-Fi as WAN undo complete."
:put "Check WiFi with: /interface wifi print detail"
