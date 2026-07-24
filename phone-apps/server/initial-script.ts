export const initialScript = String
  .raw`# RouterOS v7 script: use Wi-Fi package radios as WAN uplinks.
# This targets the newer /interface wifi package, usually wifi1 and wifi2.

:local ssid "LONG_PING_IS_LONG"
:local wifiPassword "pandaexpress"
:local wifiInterfaces {"wifi1";"wifi2"}
:local backupWifiInterface "wifi2"
:local useWifi2Backup false
:local natComment "wifi-as-wan masquerade"
:local dhcpCommentPrefix "wifi-as-wan dhcp client"
:local internetCheckTargets {"1.1.1.1";"8.8.8.8"}

:if ($useWifi2Backup = false) do={
    :put ("WiFi backup disabled; disabling " . $backupWifiInterface)

    :if ([:len [/interface wifi find name=$backupWifiInterface]] > 0) do={
        /interface wifi set [find name=$backupWifiInterface] disabled=yes
    }

    :foreach backupClient in=[/ip dhcp-client find interface=$backupWifiInterface] do={
        /ip dhcp-client set $backupClient disabled=yes
    }

    :foreach backupWanMember in=[/interface list member find list="WAN" interface=$backupWifiInterface] do={
        /interface list member remove $backupWanMember
    }

    :foreach backupRoute in=[/ip route find dst-address="0.0.0.0/0" gateway=$backupWifiInterface dynamic=no] do={
        /ip route remove $backupRoute
    }
}

:foreach internetCheckTarget in=$internetCheckTargets do={
    :if ([/ping address=$internetCheckTarget count=2 interval=500ms] > 0) do={
        :put ("Internet is reachable via " . $internetCheckTarget . "; skipping Wi-Fi as WAN changes.")
        :return
    }
}

:put ("Configuring RouterOS v7 WiFi package radios as WAN for SSID " . $ssid)

# Make default firewall rules treat the WiFi clients as WAN.
:if ([:len [/interface list find name="WAN"]] = 0) do={
    /interface list add name="WAN"
}

:local routeDistance 1

:foreach wifiInterface in=$wifiInterfaces do={
    :if ([:len [/interface wifi find name=$wifiInterface]] = 0) do={
        :put ("Skipping missing WiFi interface " . $wifiInterface)
    } else={
        :local shouldConfigure true
        :if ($wifiInterface = $backupWifiInterface) do={
            :if ($useWifi2Backup = false) do={
                :set shouldConfigure false
                :put ("Skipping " . $wifiInterface . " because WiFi backup is disabled")
            }
        }

        :if ($shouldConfigure = true) do={
            :put ("Configuring " . $wifiInterface . " as station WAN")

            # Keep the WiFi client out of the LAN bridge so it behaves like a WAN port.
            :foreach bridgePort in=[/interface bridge port find interface=$wifiInterface] do={
                /interface bridge port remove $bridgePort
            }

            /interface wifi set [find name=$wifiInterface] \
                configuration.mode=station \
                configuration.ssid=$ssid \
                security.authentication-types=wpa2-psk \
                security.ft=no \
                security.ft-over-ds=no \
                security.passphrase=$wifiPassword \
                disabled=no

            :if ([:len [/interface list member find list="WAN" interface=$wifiInterface]] = 0) do={
                /interface list member add list="WAN" interface=$wifiInterface
            }

            # DHCP gets the upstream IP, default route, and DNS from the WiFi network.
            :local dhcpComment ($dhcpCommentPrefix . " " . $wifiInterface)
            :if ([:len [/ip dhcp-client find interface=$wifiInterface]] = 0) do={
                /ip dhcp-client add \
                    interface=$wifiInterface \
                    add-default-route=yes \
                    default-route-distance=$routeDistance \
                    use-peer-dns=yes \
                    disabled=no \
                    comment=$dhcpComment
            } else={
                /ip dhcp-client set [find interface=$wifiInterface] \
                    add-default-route=yes \
                    default-route-distance=$routeDistance \
                    use-peer-dns=yes \
                    disabled=no \
                    comment=$dhcpComment
            }

            :set routeDistance ($routeDistance + 1)
        }
    }
}

# Remove stale inactive static default routes pointing directly at WiFi interfaces.
:foreach wifiInterface in=$wifiInterfaces do={
    :foreach staleRoute in=[/ip route find dst-address="0.0.0.0/0" gateway=$wifiInterface dynamic=no] do={
        /ip route remove $staleRoute
    }
}

# NAT LAN traffic out through the WiFi WAN interfaces.
:if ([:len [/ip firewall nat find comment=$natComment]] = 0) do={
    /ip firewall nat add \
        chain=srcnat \
        out-interface-list="WAN" \
        action=masquerade \
        comment=$natComment
} else={
    /ip firewall nat set [find comment=$natComment] \
        chain=srcnat \
        out-interface-list="WAN" \
        action=masquerade
}

:put "Wi-Fi as WAN configuration complete."
:put "Check WiFi status with: /interface wifi registration-table print"
:put "Check DHCP with: /ip dhcp-client print detail"
`;
